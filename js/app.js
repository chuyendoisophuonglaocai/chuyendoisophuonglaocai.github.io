import firebaseConfig from './firebase-config.js';

// Initialize Firebase
let db, storage, analytics;
try {
    if (typeof firebase === 'undefined') {
        throw new Error("Firebase SDK chưa được tải. Vui lòng kiểm tra kết nối mạng.");
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    storage = firebase.storage();
    analytics = firebase.analytics ? firebase.analytics() : null;
} catch (error) {
    console.error("Firebase init error:", error);
}

// State
let currentUserIP = '';
let isAdmin = false;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await fetchIP();
    setupAdminSession(); 
    setupTabs();
    setupForm();
    setupAdmin();
    loadCategories();
    loadIdeas();
    
    const sortOrderSelect = document.getElementById('sort-order');
    const categoryFilter = document.getElementById('category-filter');
    const searchInput = document.getElementById('search-input');

    if (sortOrderSelect) sortOrderSelect.addEventListener('change', loadIdeas);
    if (categoryFilter) categoryFilter.addEventListener('change', loadIdeas);
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            loadIdeas();
        }, 500));
    }
});

function setupAdminSession() {
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        processLoginSuccess();
    }
}

function processLoginSuccess() {
    isAdmin = true;
    const adminLoginUI = document.getElementById('admin-login-ui');
    const adminDashboard = document.getElementById('admin-dashboard');
    
    if (adminLoginUI) adminLoginUI.classList.add('hidden');
    if (adminDashboard) adminDashboard.classList.remove('hidden');
    loadAdminDashboard();
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Fetch IP
async function fetchIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        currentUserIP = data.ip.replace(/\./g, '_');
    } catch (error) {
        console.error("Error fetching IP:", error);
    }
}

// Tabs Logic
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.add('active');
            if (target === 'feed') loadIdeas();
        });
    });
}

// Form Logic
function setupForm() {
    const ideaForm = document.getElementById('idea-form');
    if (!ideaForm) return;

    const imageInput = document.getElementById('images');
    const previewContainer = document.getElementById('image-preview');
    let processedImages = [];

    imageInput.addEventListener('change', async (e) => {
        previewContainer.innerHTML = '';
        processedImages = [];
        const files = Array.from(e.target.files).slice(0, 3);
        
        for (const file of files) {
            const base64 = await resizeImage(file, 400, 400, 0.7);
            processedImages.push(base64);
            const img = document.createElement('img');
            img.src = base64;
            img.className = 'idea-image';
            img.style.width = '80px';
            previewContainer.appendChild(img);
        }
    });

    ideaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const detailFile = document.getElementById('detail-file').files[0];
        if (detailFile && detailFile.size > 20480) {
            showToast("File chi tiết phải dưới 20KB!", "danger");
            return;
        }

        const ideaData = {
            category: document.getElementById('category').value,
            title: document.getElementById('title').value,
            description: document.getElementById('description').value,
            author: {
                name: document.getElementById('fullname').value,
                phone: document.getElementById('phone').value,
                address: document.getElementById('address').value
            },
            socialLink: document.getElementById('social-link').value,
            status: 'pending',
            timestamp: Date.now(),
            likes: 0,
            images: processedImages,
            commentsCount: 0
        };

        try {
            showToast("Đang gửi...", "primary");
            if (detailFile) {
                ideaData.fileBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(detailFile);
                });
                ideaData.fileName = detailFile.name;
            }

            await db.ref('ideas').push().set(ideaData);
            showToast("Đã gửi! Vui lòng chờ phê duyệt.", "success");
            ideaForm.reset();
            previewContainer.innerHTML = '';
            processedImages = [];
            document.querySelector('[data-tab="feed"]').click();
        } catch (error) {
            showToast("Lỗi: " + error.message, "danger");
        }
    });
}

// Load Categories
function loadCategories() {
    db.ref('categories').on('value', (snapshot) => {
        const categories = [];
        snapshot.forEach(child => categories.push({ id: child.key, ...child.val() }));
        
        const filter = document.getElementById('category-filter');
        const select = document.getElementById('category');
        const adminList = document.getElementById('categories-list');

        if (filter) {
            filter.innerHTML = '<option value="all">Tất cả lĩnh vực</option>';
            categories.forEach(cat => filter.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
        }
        if (select) {
            select.innerHTML = '<option value="">-- Chọn danh mục --</option>';
            categories.forEach(cat => select.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
        }
        if (adminList) {
            adminList.innerHTML = '';
            categories.forEach(cat => {
                const div = document.createElement('div');
                div.className = 'category-chip';
                div.innerHTML = `${cat.name} <i class="fas fa-times delete-cat" onclick="deleteCategory('${cat.id}')"></i>`;
                adminList.appendChild(div);
            });
        }
    });
}

window.addCategory = async () => {
    const name = document.getElementById('new-category-name').value.trim();
    if (name) {
        await db.ref('categories').push({ name });
        document.getElementById('new-category-name').value = '';
    }
};

window.deleteCategory = async (id) => {
    if (confirm("Xóa lĩnh vực này?")) await db.ref('categories').child(id).remove();
};

// Render Functions & Others...
function loadIdeas() {
    const container = document.getElementById('ideas-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>';
    db.ref('ideas').orderByChild('status').equalTo('approved').once('value', (snapshot) => {
        let ideas = [];
        snapshot.forEach(child => ideas.push({ id: child.key, ...child.val() }));

        const filter = document.getElementById('category-filter')?.value || 'all';
        if (filter !== 'all') ideas = ideas.filter(i => i.category === filter);

        const search = document.getElementById('search-input')?.value.trim().toLowerCase();
        if (search) ideas = ideas.filter(i => i.title.toLowerCase().includes(search));

        const sort = document.getElementById('sort-order')?.value || 'likes';
        ideas.sort((a,b) => sort === 'likes' ? (b.likes||0)-(a.likes||0) : b.timestamp-a.timestamp);

        renderIdeas(ideas, container, false);
    });
}

const downloadFile = (base64, name) => {
    const link = document.createElement('a');
    link.href = base64;
    link.download = name || 'file';
    link.click();
};
window.downloadFile = downloadFile;

function renderIdeas(ideas, container, isAdminView = false) {
    container.innerHTML = ideas.length ? '' : '<p style="text-align:center; color:var(--text-muted);">Không tìm thấy ý tưởng nào.</p>';
    ideas.forEach(idea => {
        const card = document.createElement('div');
        card.className = 'glass-panel idea-card' + (isAdminView ? ' expanded' : '');
        
        const fileLink = idea.fileBase64 ? `<a href="javascript:void(0)" onclick="event.stopPropagation(); downloadFile('${idea.fileBase64}', '${idea.fileName}')" style="color:var(--primary); font-size:0.8rem; display:block; margin-bottom:0.5rem;"><i class="fas fa-file-download"></i> Tải file</a>` : '';
        const imgHtml = idea.images?.map(img => `<img src="${img}" class="idea-image" onclick="event.stopPropagation(); window.open('${img}')">`).join('') || '';

        card.innerHTML = `
            <div class="collapsed-info">
                <span class="idea-title" style="max-width:70%; overflow:hidden; text-overflow:ellipsis;">${idea.title}</span>
                <div style="display:flex; align-items:center; gap:0.8rem; font-size:0.85rem;">
                    <span><i class="fas fa-heart" style="color:var(--danger)"></i> ${idea.likes||0}</span>
                    <i class="fas fa-chevron-down toggle-icon"></i>
                </div>
            </div>
            <div class="expanded-content">
                <div class="idea-header" style="margin-top:1rem;">
                    <span class="category-tag">${idea.category}</span>
                    <span style="font-size:0.7rem;">${new Date(idea.timestamp).toLocaleDateString()}</span>
                </div>
                <p style="font-size:0.9rem; margin:0.5rem 0;">Người đăng: ${idea.author.name} ${isAdminView ? `(${idea.author.phone})` : ''}</p>
                <p style="font-size:0.95rem;">${idea.description}</p>
                ${fileLink}
                <div class="idea-images">${imgHtml}</div>
                ${!isAdminView ? `
                    <div class="idea-actions">
                        <button class="action-btn" onclick="event.stopPropagation(); handleLike('${idea.id}')"><i class="fas fa-heart"></i> ${idea.likes||0}</button>
                        <button class="action-btn" onclick="event.stopPropagation(); toggleComments('${idea.id}')"><i class="fas fa-comment"></i> ${idea.commentsCount||0}</button>
                    </div>
                    <div id="comment-section-${idea.id}" class="comment-box hidden" onclick="event.stopPropagation()">
                        <div id="comments-${idea.id}"></div>
                        <input type="text" id="input-${idea.id}" placeholder="Bình luận...">
                        <button class="btn btn-primary" onclick="handleComment('${idea.id}')">Gửi</button>
                    </div>
                ` : `
                    <div style="margin-top:1rem; border-top:1px solid var(--glass-border); padding-top:1rem; display:flex; gap:0.5rem;">
                        ${idea.status==='pending' ? `<button class="btn btn-primary" onclick="event.stopPropagation(); approveIdea('${idea.id}')">Duyệt</button>` : ''}
                        <button class="btn" style="background:var(--accent); color:white;" onclick="event.stopPropagation(); editIdea('${idea.id}')">Sửa</button>
                        <button class="btn btn-danger" onclick="event.stopPropagation(); deleteIdea('${idea.id}')">Xóa</button>
                    </div>
                `}
            </div>
        `;

        if (!isAdminView) {
            card.onclick = () => {
                card.classList.toggle('expanded');
                const icon = card.querySelector('.toggle-icon');
                icon.classList.toggle('fa-chevron-up');
                icon.classList.toggle('fa-chevron-down');
            };
        }
        container.appendChild(card);
    });
}

// Like, Comment, Admin Actions
window.handleLike = async (id) => {
    if (localStorage.getItem('liked_'+id)) return showToast("Bạn đã thích rồi!", "primary");
    await db.ref(`ideas/${id}/likes`).transaction(c => (c||0)+1);
    localStorage.setItem('liked_'+id, 'true');
    loadIdeas();
};

window.handleComment = async (id) => {
    const val = document.getElementById('input-'+id).value.trim();
    if (val) {
        await db.ref(`comments/${id}`).push({ text: val, timestamp: Date.now() });
        await db.ref(`ideas/${id}/commentsCount`).transaction(c => (c||0)+1);
        document.getElementById('input-'+id).value = '';
        loadComments(id);
    }
};

window.toggleComments = (id) => {
    const box = document.getElementById(`comment-section-${id}`);
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) loadComments(id);
};

function loadComments(id) {
    const el = document.getElementById('comments-'+id);
    db.ref(`comments/${id}`).once('value', snap => {
        el.innerHTML = '';
        snap.forEach(c => {
            const div = document.createElement('div');
            div.className = 'comment';
            div.innerHTML = `<span>${c.val().text}</span> ${isAdmin ? `<button onclick="deleteComment('${id}','${c.key}')">Xóa</button>` : ''}`;
            el.appendChild(div);
        });
    });
}

function setupAdmin() {
    const btn = document.getElementById('btn-login');
    if (btn) {
        btn.onclick = () => {
            const u = document.getElementById('admin-user').value.trim();
            const p = document.getElementById('admin-pass').value.trim();
            if (u === 'ADMIN' && p === 'tranhuyhoang') {
                localStorage.setItem('adminLoggedIn', 'true');
                processLoginSuccess();
                showToast("Thành công!", "success");
            } else {
                showToast("Sai thông tin!", "danger");
            }
        };
    }
    const logout = document.getElementById('btn-logout');
    if (logout) {
        logout.onclick = () => {
            localStorage.removeItem('adminLoggedIn');
            location.reload();
        };
    }
}

function loadAdminDashboard() {
    db.ref('ideas').orderByChild('status').equalTo('pending').on('value', snap => {
        const ideas = [];
        snap.forEach(c => ideas.push({ id: c.key, ...c.val() }));
        const el = document.getElementById('pending-container');
        if (el) renderIdeas(ideas, el, true);
    });
    db.ref('ideas').on('value', snap => {
        const ideas = [];
        snap.forEach(c => ideas.push({ id: c.key, ...c.val() }));
        ideas.sort((a,b) => b.timestamp - a.timestamp);
        const el = document.getElementById('all-ideas-container');
        if (el) renderIdeas(ideas, el, true);
    });
}

window.approveIdea = async (id) => { if(isAdmin) await db.ref(`ideas/${id}`).update({status:'approved'}); };
window.deleteIdea = async (id) => { if(isAdmin && confirm("Xóa?")) await db.ref(`ideas/${id}`).remove(); };
window.editIdea = async (id) => {
    if(!isAdmin) return;
    const snap = await db.ref(`ideas/${id}`).once('value');
    const t = prompt("Tên:", snap.val().title);
    const d = prompt("Mô tả:", snap.val().description);
    if(t && d) await db.ref(`ideas/${id}`).update({title:t, description:d});
};

function resizeImage(file, maxWidth, maxHeight, quality) {
    return new Promise(res => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxWidth) { h *= maxWidth/w; w = maxWidth; } }
                else { if (h > maxHeight) { w *= maxHeight/h; h = maxHeight; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                res(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function showToast(msg, type) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeft = `5px solid var(--${type||'primary'})`;
    t.innerHTML = `<span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3000);
}
