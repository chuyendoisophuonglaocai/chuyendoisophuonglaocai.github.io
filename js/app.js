import firebaseConfig from './firebase-config.js';

// Initialize Firebase
let db, storage, analytics;
try {
    if (typeof firebase === 'undefined') {
        throw new Error("Firebase SDK chưa được tải. Vui lòng kiểm tra kết nối mạng.");
    }
    // Check if firebase is already initialized
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    db = app.database();
    storage = app.storage ? app.storage() : null;
    analytics = app.analytics ? app.analytics() : null;
} catch (error) {
    console.error("Firebase init error:", error);
}

// State
let currentUserIP = '';
let isAdmin = false;
const ITEMS_PER_PAGE = 15;
let state = {
    feed: { page: 1, total: 0, ideas: [] },
    pending: { page: 1, total: 0, ideas: [] },
    allAdmin: { page: 1, total: 0, ideas: [] },
    commentsAdmin: { page: 1, total: 0, comments: [] },
    adminSearch: '',
    adminCat: 'all',
    expandedId: null,
    adminPermissions: {
        approve: false,
        edit: false,
        delete: false,
        comment: false,
        category: false,
        deleteCategory: false
    }
};

// Content Filter
const PROHIBITED_WORDS = [
    // Tiếng Việt phổ biến & viết tắt
    'đm', 'dm', 'đcm', 'dcm', 'vcl', 'vkl', 'vcc', 'vclm', 'clm', 'cl', 'loz', 'lồn', 'lon', 'cặc', 'cac', 'địt', 'dit', 'đú', 'du', 'đéo', 'deo', 'đis', 'dis', 'mẹ mày', 'me may', 'con mẹ', 'bố mày', 'bo may', 'thằng chó', 'thang cho', 'ngu lol', 'ngu lồn', 'hãm', 'ham', 'đù', 'du', 'đm',
    // Tiếng Anh (English profanity)
    'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'pussy', 'dick', 'cock', 'sex', 'porn', 'fucker', 'hell', 'damn',
    // Nội dung nhạy cảm/chính trị (Highly sensitive)
    'phản động', 'phan dong', 'biểu tình', 'bieu tinh', 'kích động', 'kich dong', 'chế độ', 'che do', 'nhà nước', 'nha nuoc', 'biểu tình', 'đảng', 'dang', 'biểu tình'
];

function isCleanContent(text) {
    if (!text) return true;
    // Normalize: lowercase and remove ALL special characters/spaces to catch 'd.m', 'v_c_l', etc.
    const normalizedText = text.toLowerCase().replace(/[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, '');
    
    return !PROHIBITED_WORDS.some(word => {
        const cleanWord = word.replace(/\s+/g, ''); // also clean spaces in prohibited words for comparison
        return normalizedText.includes(cleanWord);
    });
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await fetchIP();
    setupAdminSession(); 
    setupTabs();
    setupForm();
    setupAdmin();
    loadCategories();
    loadIdeas();
    setupLightbox();
    setupInteractiveBG();
    
    const sortOrderSelect = document.getElementById('sort-order');
    const categoryFilter = document.getElementById('category-filter');
    const searchInput = document.getElementById('search-input');
    const btnAddCat = document.getElementById('btn-add-category');

    if (sortOrderSelect) sortOrderSelect.addEventListener('change', () => { state.feed.page = 1; loadIdeas(); });
    if (categoryFilter) categoryFilter.addEventListener('change', () => { state.feed.page = 1; loadIdeas(); });
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            state.feed.page = 1;
            loadIdeas();
        }, 500));
    }
    if (btnAddCat) {
        btnAddCat.onclick = (e) => {
            e.preventDefault();
            window.addCategory();
        };
    }

    // Admin Filters
    const adminSearchInput = document.getElementById('admin-search');
    const adminCatFilter = document.getElementById('admin-category-filter');
    if (adminSearchInput) {
        adminSearchInput.addEventListener('input', debounce((e) => {
            state.adminSearch = e.target.value.toLowerCase();
            state.allAdmin.page = 1;
            loadAdminDashboard();
        }, 500));
    }
    if (adminCatFilter) {
        adminCatFilter.addEventListener('change', (e) => {
            state.adminCat = e.target.value;
            state.allAdmin.page = 1;
            loadAdminDashboard();
        });
    }
});

function setupAdminSession() {
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        processLoginSuccess();
    }
}

function processLoginSuccess() {
    isAdmin = true;
    const initialData = JSON.parse(localStorage.getItem('adminData') || '{}');
    state.adminPermissions = initialData.permissions || {
        approve: false, edit: false, delete: false, comment: false, category: false, deleteCategory: false
    };

    // --- RE-SYNC PERMISSIONS IN REAL-TIME ---
    // This allows Admin 0 to change permissions while Admin 1 is logged in
    const adminsRef = db.ref('admins');
    adminsRef.once('value').then(snap => {
        let adminKey = null;
        snap.forEach(child => {
            if(child.val().username === initialData.username) adminKey = child.key;
        });
        
        if (adminKey) {
            db.ref(`admins/${adminKey}/permissions`).on('value', permsSnap => {
                if(permsSnap.exists()) {
                    state.adminPermissions = permsSnap.val();
                    // Update the local storage copy too
                    initialData.permissions = state.adminPermissions;
                    localStorage.setItem('adminData', JSON.stringify(initialData));
                    // Re-load UI elements that depend on permissions
                    loadCategories();
                    loadAdminDashboard();
                }
            });
        }
    });
    // ----------------------------------------

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

// Interactive Background
function setupInteractiveBG() {
    const spotlight = document.getElementById('bg-spotlight');
    if (!spotlight) return;

    window.addEventListener('mousemove', (e) => {
        spotlight.style.left = e.clientX + 'px';
        spotlight.style.top = e.clientY + 'px';
    });
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

        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const fullname = document.getElementById('fullname').value;

        if (!isCleanContent(title) || !isCleanContent(description) || !isCleanContent(fullname)) {
            return showToast("Nội dung chứa từ ngữ không phù hợp. Vui lòng kiểm tra lại!", "danger");
        }

        const ideaData = {
            category: document.getElementById('category').value,
            title: title,
            description: description,
            author: {
                name: fullname,
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
    if (!db) return;
    db.ref('categories').on('value', (snapshot) => {
        const categories = [];
        snapshot.forEach(child => {
            const data = child.val();
            if (typeof data === 'object' && data !== null) {
                categories.push({ id: child.key, ...data });
            } else {
                categories.push({ id: child.key, name: data });
            }
        });
        
        const filter = document.getElementById('category-filter');
        const select = document.getElementById('category');
        const adminList = document.getElementById('categories-list');
        const adminFilter = document.getElementById('admin-category-filter');

        if (filter) {
            filter.innerHTML = '<option value="all">Tất cả lĩnh vực</option>';
            categories.forEach(cat => filter.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
        }
        if (adminFilter) {
            adminFilter.innerHTML = '<option value="all">Tất cả lĩnh vực</option>';
            categories.forEach(cat => adminFilter.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
            adminFilter.value = state.adminCat;
        }
        if (select) {
            select.innerHTML = '<option value="">-- Chọn danh mục --</option>';
            categories.forEach(cat => select.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
        }
        if (adminList) {
            adminList.innerHTML = '';
            if (categories.length === 0) {
                adminList.innerHTML = '<p style="color:var(--text-muted); font-size:0.8rem;">Chưa có lĩnh vực nào.</p>';
            }
            categories.forEach(cat => {
                const val = (typeof cat === 'object' && cat.name) ? cat.name : (typeof cat === 'string' ? cat : (cat.name || 'Không tên'));
                const div = document.createElement('div');
                div.className = 'category-chip';
                div.innerHTML = `
                    <span class="cat-name">${val}</span>
                    ${state.adminPermissions.deleteCategory ? `
                    <i class="fas fa-times delete-cat" onclick="event.stopPropagation(); window.deleteCategory('${cat.id}')"></i>
                    ` : ''}
                `;
                adminList.appendChild(div);
            });
        }
    });
}

window.addCategory = async () => {
    if (!isAdmin || !state.adminPermissions.category) return showToast("Bạn không có quyền thêm lĩnh vực!", "danger");
    const input = document.getElementById('new-category-name');
    if (!input) return;
    const name = input.value.trim();
    if (name) {
        try {
            await db.ref('categories').push({ name });
            input.value = '';
            showToast("Đã thêm lĩnh vực!", "success");
        } catch (e) {
            showToast("Lỗi: " + e.message, "danger");
        }
    } else {
        showToast("Vui lòng nhập tên lĩnh vực!", "primary");
    }
};

window.deleteCategory = async (id) => {
    if (!isAdmin || !state.adminPermissions.deleteCategory) return showToast("Bạn không có quyền xóa lĩnh vực!", "danger");
    if (confirm("Xóa lĩnh vực này?")) {
        try {
            await db.ref('categories').child(id).remove();
            showToast("Đã xóa lĩnh vực!", "success");
        } catch (e) {
            showToast("Lỗi khi xóa!", "danger");
        }
    }
};

// Render Functions & Others...
// Render Functions
function loadIdeas() {
    const container = document.getElementById('ideas-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner" style="text-align: center; grid-column: 1/-1"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p>Đang tải ý tưởng...</p></div>';
    
    // Clear previous listener if any to avoid duplicates
    db.ref('ideas').off('value');
    db.ref('ideas').on('value', (snapshot) => {
        let allIdeas = [];
        snapshot.forEach(child => {
            const data = child.val();
            // Only show approved ideas on home page
            if (data && data.status === 'approved') {
                allIdeas.push({ id: child.key, ...data });
            }
        });

        const filter = document.getElementById('category-filter')?.value || 'all';
        let filteredIdeas = allIdeas;
        if (filter !== 'all') filteredIdeas = allIdeas.filter(i => i.category === filter);

        const search = document.getElementById('search-input')?.value.trim().toLowerCase();
        if (search) {
            filteredIdeas = filteredIdeas.filter(i => 
                (i.title && i.title.toLowerCase().includes(search)) ||
                (i.description && i.description.toLowerCase().includes(search)) ||
                (i.author?.name && i.author.name.toLowerCase().includes(search))
            );
        }

        const sort = document.getElementById('sort-order')?.value || 'likes';
        filteredIdeas.sort((a,b) => sort === 'likes' ? (b.likes||0)-(a.likes||0) : b.timestamp-a.timestamp);

        state.feed.ideas = filteredIdeas;
        state.feed.total = filteredIdeas.length;
        
        console.log(`[Home] Render ${filteredIdeas.length} ideas.`);
        renderIdeasWithPagination('feed', container, 'ideas-pagination');
    }, error => {
        console.error("Load ideas error:", error);
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--danger);">Không thể kết nối dữ liệu.</p>';
    });
}

function renderIdeasWithPagination(sectionKey, container, paginationId, isAdminView = false) {
    const s = state[sectionKey];
    const start = (s.page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedIdeas = s.ideas.slice(start, end);

    renderIdeas(paginatedIdeas, container, isAdminView);
    renderPagination(paginationId, s.total, s.page, (newPage) => {
        s.page = newPage;
        if (sectionKey === 'feed') {
            renderIdeasWithPagination(sectionKey, container, paginationId, isAdminView);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            renderIdeasWithPagination(sectionKey, container, paginationId, isAdminView);
        }
    });
}

function renderPagination(navId, total, current, onPageChange) {
    const nav = document.getElementById(navId);
    if (!nav) return;
    
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
    if (totalPages <= 1) {
        nav.innerHTML = '';
        return;
    }

    let html = `
        <button class="page-btn ${current === 1 ? 'disabled' : ''}" onclick="window.changePage('${navId}', ${current - 1})"><i class="fas fa-chevron-left"></i></button>
    `;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) {
            html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="window.changePage('${navId}', ${i})">${i}</button>`;
        } else if (i === current - 2 || i === current + 2) {
            html += `<span style="color:var(--text-muted)">...</span>`;
        }
    }

    html += `
        <button class="page-btn ${current === totalPages ? 'disabled' : ''}" onclick="window.changePage('${navId}', ${current + 1})"><i class="fas fa-chevron-right"></i></button>
    `;
    
    nav.innerHTML = html;
    window._pageCallbacks = window._pageCallbacks || {};
    window._pageCallbacks[navId] = onPageChange;
}

window.changePage = (navId, page) => {
    if (window._pageCallbacks[navId]) window._pageCallbacks[navId](page);
};

const downloadFile = (base64, name) => {
    const link = document.createElement('a');
    link.href = base64;
    link.download = name || 'file';
    link.click();
};
window.downloadFile = downloadFile;

function renderIdeas(ideas, container, isAdminView = false) {
    if (!isAdminView) {
        container.innerHTML = ideas.length ? '' : '<p style="text-align:center; color:var(--text-muted); padding: 2rem; grid-column: 1/-1;">Không tìm thấy ý tưởng nào.</p>';
        ideas.forEach(idea => {
            const card = document.createElement('div');
            const isExpanded = state.expandedId === idea.id;
            card.className = `glass-panel idea-card ${isExpanded ? 'expanded' : ''}`;
            card.dataset.id = idea.id;
            
            const fileLink = idea.fileBase64 ? `<a href="javascript:void(0)" onclick="event.stopPropagation(); downloadFile('${idea.fileBase64}', '${idea.fileName}')" style="color:var(--primary); font-size:0.8rem; display:block; margin-bottom:0.5rem;"><i class="fas fa-file-download"></i> Tải file: ${idea.fileName}</a>` : '';
            const imgHtml = idea.images?.map(img => `<img src="${img}" class="idea-image" onclick="event.stopPropagation(); window.openLightbox('${img}')">`).join('') || '';

            card.innerHTML = `
                <div class="collapsed-info">
                    <span class="idea-title" style="max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space: nowrap;">${idea.title || 'Không tiêu đề'}</span>
                    <div style="display:flex; align-items:center; gap:0.8rem; font-size:0.85rem;">
                        <span><i class="fas fa-heart" style="color:var(--danger)"></i> ${idea.likes||0}</span>
                        <i class="fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} toggle-icon"></i>
                    </div>
                </div>
                <div class="expanded-content" style="display: ${isExpanded ? 'block' : 'none'}; opacity: ${isExpanded ? '1' : '0'};">
                    <div class="idea-header" style="margin-top:1rem;">
                        <span class="category-tag">${idea.category}</span>
                        <span style="font-size:0.7rem;">${new Date(idea.timestamp).toLocaleDateString()}</span>
                    </div>
                    <p style="font-size:0.9rem; margin:0.5rem 0;">Người đăng: ${idea.author.name}</p>
                    <div class="idea-description" style="font-size:0.95rem; line-height: 1.5; margin-bottom: 1rem;">${idea.description}</div>
                    ${fileLink}
                    <div class="idea-images">${imgHtml}</div>
                    <div class="idea-actions">
                        <button class="action-btn" onclick="event.stopPropagation(); handleLike('${idea.id}')"><i class="fas fa-heart"></i> ${idea.likes||0}</button>
                        <button class="action-btn" onclick="event.stopPropagation(); toggleComments('${idea.id}')"><i class="fas fa-comment"></i> ${idea.commentsCount||0}</button>
                    </div>
                    <p style="font-size: 0.7rem; color: var(--primary); opacity: 0.8; margin-bottom: 1rem;"><i class="fas fa-shield-alt"></i> Bạn chỉ được Thích 1 lần và Bình luận 1 lần duy nhất.</p>
                    <div id="comment-section-${idea.id}" class="comment-box hidden" onclick="event.stopPropagation()">
                        <div id="comments-${idea.id}"></div>
                        <input type="text" id="input-${idea.id}" placeholder="Viết bình luận của bạn...">
                        <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 5px;"><i class="fas fa-info-circle"></i> Bình luận của bạn sẽ là duy nhất và không thể sửa, chỉ có thể xóa để viết lại.</p>
                        <button class="btn btn-primary" style="margin-top: 10px;" onclick="handleComment('${idea.id}')">Gửi bình luận</button>
                    </div>
                </div>
            `;
            
            card.onclick = (e) => {
                // If clicked a button/link inside, don't toggle card
                if (e.target.closest('.action-btn, a, button, .comment-box, .idea-images img')) return;

                const isCurrentlyExpanded = card.classList.contains('expanded');
                
                // 1. Collapse all others
                document.querySelectorAll('.idea-card.expanded').forEach(other => {
                    if (other !== card) {
                        other.classList.remove('expanded');
                        const otherContent = other.querySelector('.expanded-content');
                        if (otherContent) {
                            otherContent.style.display = 'none';
                            otherContent.style.opacity = '0';
                        }
                        const otherIcon = other.querySelector('.toggle-icon');
                        if (otherIcon) {
                            otherIcon.classList.remove('fa-chevron-up');
                            otherIcon.classList.add('fa-chevron-down');
                        }
                    }
                });

                // 2. Toggle this one
                const content = card.querySelector('.expanded-content');
                const icon = card.querySelector('.toggle-icon');

                if (isCurrentlyExpanded) {
                    card.classList.remove('expanded');
                    if(content) { content.style.display = 'none'; content.style.opacity = '0'; }
                    if(icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
                    state.expandedId = null;
                } else {
                    card.classList.add('expanded');
                    if(content) { 
                        content.style.display = 'block'; 
                        setTimeout(() => content.style.opacity = '1', 10); 
                    }
                    if(icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
                    state.expandedId = idea.id;
                }
            };
            container.appendChild(card);
        });
    } else {
        // Admin View - Slim 1 Line Row
        container.innerHTML = ideas.length ? '' : '<p style="text-align:center; color:var(--text-muted); padding: 1.5rem;">Không có dữ liệu.</p>';
        
        ideas.forEach((idea, index) => {
            const row = document.createElement('div');
            row.className = 'idea-row';
            
            const imgHtml = idea.images?.slice(0, 2).map(img => `<img src="${img}" class="admin-img-thumb" onclick="event.stopPropagation(); window.openLightbox('${img}')">`).join('') || '';

            row.innerHTML = `
                <div class="cell" style="color: var(--text-muted); font-weight: 700;">${index + 1}</div>
                <div class="cell cell-title" title="${idea.title}">${idea.title}</div>
                <div class="cell cell-author" style="font-size: 0.75rem;">${idea.author.name}</div>
                <div class="cell"><span class="category-tag" style="font-size: 0.65rem; padding: 2px 8px;">${idea.category}</span></div>
                <div class="cell cell-images">${imgHtml}</div>
                <div class="cell cell-actions">
                    ${idea.status === 'pending' && state.adminPermissions.approve ? `
                        <button class="btn btn-primary admin-btn-small" onclick="event.stopPropagation(); window.approveIdea('${idea.id}')" title="Duyệt">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : ''}
                    ${state.adminPermissions.edit ? `
                        <button class="btn admin-btn-small" style="background: var(--accent); color: white;" onclick="event.stopPropagation(); window.editIdea('${idea.id}')" title="Sửa">
                            <i class="fas fa-edit"></i>
                        </button>
                    ` : ''}
                    ${state.adminPermissions.delete ? `
                        <button class="btn btn-danger admin-btn-small" onclick="event.stopPropagation(); window.deleteIdea('${idea.id}')" title="Xóa">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                    <button class="btn admin-btn-small" style="background: var(--text-muted); color: white;" onclick="event.stopPropagation(); viewDetails('${idea.id}')" title="Xem">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            `;
            container.appendChild(row);
        });
    }
}

window.viewDetails = async (id) => {
    const snap = await db.ref(`ideas/${id}`).once('value');
    const idea = snap.val();
    alert(`CHI TIẾT Ý TƯỞNG\n\nTên: ${idea.title}\nMô tả: ${idea.description}\nĐịa chỉ: ${idea.author.address}\n\nNhấn nút "Sửa" nếu muốn thay đổi nội dung.`);
};

// Like, Comment, Admin Actions
window.handleLike = async (id) => {
    if (!currentUserIP) return showToast("Đang xác thực kết nối...", "primary");
    
    try {
        const likeRef = db.ref(`interactions/likes/${id}/${currentUserIP}`);
        const snap = await likeRef.once('value');
        
        if (snap.exists()) {
            return showToast("Bạn đã thích ý tưởng này rồi!", "primary");
        }

        await likeRef.set(Date.now());
        await db.ref(`ideas/${id}/likes`).transaction(c => (c||0)+1);
        showToast("Cảm ơn bạn đã yêu thích!", "success");
    } catch (e) {
        showToast("Lỗi hệ thống!", "danger");
    }
};

window.handleComment = async (id) => {
    if (!currentUserIP) return showToast("Đang xác thực kết nối...", "primary");

    try {
        const logRef = db.ref(`interactions/comments/${id}/${currentUserIP}`);
        const snap = await logRef.once('value');

        if (snap.exists()) {
            return showToast("Bạn chỉ được bình luận một lần cho mỗi ý tưởng!", "primary");
        }

        const input = document.getElementById('input-'+id);
        const val = input.value.trim();

        if (!isCleanContent(val)) {
            return showToast("Bình luận chứa từ ngữ không phù hợp!", "danger");
        }
        
        if (val) {
            showToast("Đang gửi...", "primary");
            await logRef.set(Date.now());
            await db.ref(`comments/${id}`).push({ 
                text: val, 
                timestamp: Date.now(),
                ip: currentUserIP 
            });
            await db.ref(`ideas/${id}/commentsCount`).transaction(c => (c||0)+1);
            input.value = '';
            loadComments(id);
            showToast("Đã gửi bình luận!", "success");
        }
    } catch (e) {
        showToast("Lỗi: " + e.message, "danger");
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
            div.innerHTML = `
                <span>${c.val().text}</span>
                ${(isAdmin && state.adminPermissions.comment) || (currentUserIP && c.val().ip === currentUserIP) ? `
                <button class="delete-comment-btn" onclick="window.deleteComment('${id}', '${c.key}')" title="Xóa">
                    <i class="fas fa-trash-alt"></i>
                </button>` : ''}
            `;
            el.appendChild(div);
        });
    });
}

window.deleteComment = async (ideaId, commentId) => {
    try {
        const commentSnap = await db.ref(`comments/${ideaId}/${commentId}`).once('value');
        const commentData = commentSnap.val();
        if (!commentData) return;

        let canDelete = false;
        // 1. IP Check (Compare current IP with comment's recorded IP)
        if (currentUserIP && commentData.ip === currentUserIP) {
            canDelete = true;
        } else if (isAdmin && state.adminPermissions.comment) {
            // 2. Admin Permission Check
            canDelete = true;
        } else {
            // 3. Password Check (Fallback for Super Admin or manual override)
            const pass = prompt("Nhập mật khẩu tối cao để xóa:");
            if (pass === 'tranhuyhoang') {
                canDelete = true;
            }
        }

        if (canDelete) {
            if (confirm("Bạn có chắc chắn muốn xóa bình luận này?")) {
                await db.ref(`comments/${ideaId}/${commentId}`).remove();
                await db.ref(`ideas/${ideaId}/commentsCount`).transaction(c => (c||1)-1);
                
                // Clear the interaction log so the user can comment again
                const commenterIP = commentData.ip;
                if (commenterIP) {
                    await db.ref(`interactions/comments/${ideaId}/${commenterIP}`).remove();
                }

                showToast("Đã xóa bình luận!", "success");
                loadComments(ideaId);
            }
        } else {
            showToast("Bạn không có quyền xóa bình luận này!", "danger");
        }
    } catch (e) {
        showToast("Lỗi: " + e.message, "danger");
    }
};

function setupAdmin() {
    const btn = document.getElementById('btn-login');
    if (btn) {
        btn.onclick = async () => {
            const u = document.getElementById('admin-user').value.trim();
            const p = document.getElementById('admin-pass').value.trim();
            
            showToast("Đang xác thực...", "primary");

            // 1. Check Super Admin (Admin 0)
            if (u === 'ADMIN' && p === 'tranhuyhoang') {
                localStorage.setItem('superAdminLoggedIn', 'true');
                showToast("Chào mừng Super Admin! Đang chuyển hướng...", "success");
                setTimeout(() => {
                    location.href = 'admin0.html';
                }, 1000);
                return;
            }

            // 2. Check Regular Admin (Admin 1)
            const adminsSnap = await db.ref('admins').once('value');
            let found = null;
            adminsSnap.forEach(s => {
                const a = s.val();
                if(a.username === u && a.password === p) found = a;
            });

            if (found) {
                localStorage.setItem('adminLoggedIn', 'true');
                localStorage.setItem('adminData', JSON.stringify(found));
                processLoginSuccess();
                showToast("Đăng nhập Admin thành công!", "success");
            } else {
                showToast("Tài khoản hoặc mật khẩu không chính xác!", "danger");
            }
        };
    }
    const logout = document.getElementById('btn-logout');
    if (logout) {
        logout.onclick = () => {
            localStorage.removeItem('adminLoggedIn');
            localStorage.removeItem('adminData');
            localStorage.removeItem('superAdminLoggedIn');
            location.reload();
        };
    }
}

function loadAdminDashboard() {
    if (!db) return;
    
    // --- UI Visibility based on Permissions ---
    const catSection = document.getElementById('categories-management-section');
    const catAddGroup = document.getElementById('category-add-group');
    const commentSection = document.getElementById('comments-management-section');
    const pendingSection = document.getElementById('pending-section');

    if (catSection) {
        // Show category section if user has either category (add) or deleteCategory permission
        const hasAnyCatPerm = state.adminPermissions.category || state.adminPermissions.deleteCategory;
        catSection.style.display = hasAnyCatPerm ? 'block' : 'none';
        
        // Only show the "Add Category" input group if they have the 'category' (add) permission
        if (catAddGroup) {
            const addControls = catAddGroup.querySelector('div');
            if (addControls) {
                addControls.style.display = state.adminPermissions.category ? 'flex' : 'none';
            }
        }
    }

    if (commentSection) {
        // Only show comments management if they have comment permission
        commentSection.style.display = state.adminPermissions.comment ? 'block' : 'none';
    }

    if (pendingSection) {
        // Show pending section if they have approve permission
        pendingSection.style.display = state.adminPermissions.approve ? 'block' : 'none';
    }

    // Clear previous listener to avoid duplicates
    db.ref('ideas').off('value');
    db.ref('ideas').on('value', (snapshot) => {
        const allIdeas = [];
        snapshot.forEach(c => {
            const data = c.val();
            // Ensure status exists, default to pending if missing
            if (!data.status) data.status = 'pending';
            allIdeas.push({ id: c.key, ...data });
        });
        
        // --- Pending Ideas ---
        const pendingIdeas = allIdeas.filter(i => i.status === 'pending').sort((a,b) => b.timestamp - a.timestamp);
        state.pending.ideas = pendingIdeas;
        state.pending.total = pendingIdeas.length;
        const pendingEl = document.getElementById('pending-container');
        if (pendingEl && state.adminPermissions.approve) renderIdeasWithPagination('pending', pendingEl, 'pending-pagination', true);

        // --- All Ideas for DB View ---
        let filteredApproved = allIdeas.filter(i => i.status === 'approved').sort((a,b) => b.timestamp - a.timestamp);
        
        // Apply Admin Search
        if (state.adminSearch) {
            filteredApproved = filteredApproved.filter(i => 
                (i.title && i.title.toLowerCase().includes(state.adminSearch)) || 
                (i.author?.name && i.author.name.toLowerCase().includes(state.adminSearch))
            );
        }
        // Apply Admin Category Filter
        if (state.adminCat !== 'all') {
            filteredApproved = filteredApproved.filter(i => i.category === state.adminCat);
        }

        state.allAdmin.ideas = filteredApproved;
        state.allAdmin.total = filteredApproved.length;
        const allEl = document.getElementById('all-ideas-container');
        if (allEl) renderIdeasWithPagination('allAdmin', allEl, 'all-ideas-pagination', true);
    }, error => {
        console.error("Firebase Admin Error:", error);
        showToast("Không thể tải dữ liệu quản trị!", "danger");
    });

    // --- Load All Comments for Central Management ---
    if (state.adminPermissions.comment) loadCentralComments();
}

function loadCentralComments() {
    const container = document.getElementById('all-comments-list');
    if (!container) return;

    db.ref('comments').on('value', async (snapshot) => {
        const allCommentsList = [];
        
        const ideaTitles = {};
        const ideasSnap = await db.ref('ideas').once('value');
        ideasSnap.forEach(s => { ideaTitles[s.key] = s.val().title || 'Không tên'; });

        snapshot.forEach(ideaComments => {
            const ideaId = ideaComments.key;
            ideaComments.forEach(c => {
                allCommentsList.push({
                    id: c.key,
                    ideaId: ideaId,
                    ideaTitle: ideaTitles[ideaId],
                    ...c.val()
                });
            });
        });

        allCommentsList.sort((a,b) => b.timestamp - a.timestamp);
        
        state.commentsAdmin.comments = allCommentsList;
        state.commentsAdmin.total = allCommentsList.length;
        
        renderCommentsWithPagination(container, 'comments-pagination');
    });
}

function renderCommentsWithPagination(container, paginationId) {
    const s = state.commentsAdmin;
    const start = (s.page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginated = s.comments.slice(start, end);

    renderCentralComments(paginated, container);
    renderPagination(paginationId, s.total, s.page, (newPage) => {
        s.page = newPage;
        renderCommentsWithPagination(container, paginationId);
    });
}

function renderCentralComments(comments, container) {
    container.innerHTML = '';
    if (comments.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:2rem; color:var(--text-muted);">Chưa có bình luận nào.</p>';
        return;
    }

    comments.forEach(c => {
        const div = document.createElement('div');
        div.className = 'idea-row';
        div.style.gridTemplateColumns = '1.5fr 2fr 100px';
        div.innerHTML = `
            <div class="cell" style="font-size:0.75rem;"><i class="fas fa-lightbulb"></i> ${c.ideaTitle}</div>
            <div class="cell" style="font-weight:500;">${c.text}</div>
            <div class="cell cell-actions">
                ${state.adminPermissions.comment ? `
                    <button class="btn btn-danger admin-btn-small" onclick="window.deleteComment('${c.ideaId}', '${c.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                ` : '<span style="font-size:0.7rem; color:var(--text-muted);">Không có quyền xóa</span>'}
            </div>
        `;
        container.appendChild(div);
    });
}

function setupLightbox() {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    if (!modal) return;

    window.openLightbox = (src) => {
        modalImg.src = src;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    modal.onclick = () => {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    };
}

window.approveIdea = async (id) => { 
    if(isAdmin && state.adminPermissions.approve) {
        try {
            await db.ref(`ideas/${id}`).update({status:'approved'});
            showToast("Đã duyệt ý tưởng!", "success");
        } catch (e) {
            showToast("Lỗi khi duyệt!", "danger");
        }
    } else {
        showToast("Bạn không có quyền duyệt!", "danger");
    }
};
window.deleteIdea = async (id) => { 
    if(isAdmin && state.adminPermissions.delete) {
        if(confirm("Xóa ý tưởng này vĩnh viễn?")) await db.ref(`ideas/${id}`).remove(); 
    } else {
        showToast("Bạn không có quyền xóa!", "danger");
    }
};
window.editIdea = async (id) => {
    if(!isAdmin || !state.adminPermissions.edit) return showToast("Bạn không có quyền sửa!", "danger");
    const snap = await db.ref(`ideas/${id}`).once('value');
    const t = prompt("Sửa tên ý tưởng:", snap.val().title);
    const d = prompt("Sửa mô tả:", snap.val().description);
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
