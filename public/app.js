// ============ STATE ============
let currentUser = null;
let currentView = 'feed';
let currentProfileId = null;

// ============ PASSWORD TOGGLE ============
function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
    } else {
        input.type = 'password';
        btn.textContent = 'Show';
    }
}

// ============ API HELPERS ============
async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = '0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date + 'Z')) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(date).toLocaleDateString();
}

function isOnline(lastSeen) {
    return (new Date() - new Date(lastSeen + 'Z')) < 5 * 60 * 1000;
}

function createAvatar(user, size = '') {
    if (user.avatar_url) {
        const img = document.createElement('img');
        img.className = `avatar ${size}`;
        img.src = user.avatar_url;
        img.alt = user.display_name || user.username || '?';
        img.style.objectFit = 'cover';
        return img;
    }
    const div = document.createElement('div');
    div.className = `avatar ${size}`;
    div.style.background = user.avatar_color;
    div.textContent = (user.display_name || user.username || '?')[0];
    return div;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function linkifyContent(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function getVideoEmbed(text) {
    if (!text) return null;
    // YouTube
    const ytMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
    if (ytMatch) {
        return `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>`;
    }
    // Vimeo
    const vimeoMatch = text.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
        return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" frameborder="0" allowfullscreen></iframe>`;
    }
    return null;
}

// ============ AUTH ============
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.remove('visible');

    try {
        await api('/api/login', {
            method: 'POST',
            body: {
                username: document.getElementById('login-username').value,
                password: document.getElementById('login-password').value
            }
        });
        await initApp();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
    }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error');
    errEl.classList.remove('visible');

    try {
        await api('/api/register', {
            method: 'POST',
            body: {
                displayName: document.getElementById('reg-displayname').value,
                username: document.getElementById('reg-username').value,
                email: document.getElementById('reg-email').value,
                password: document.getElementById('reg-password').value
            }
        });
        await initApp();
        showTutorial();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    currentUser = null;
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('main-app').classList.remove('active');
});

// ============ NAVIGATION ============
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        switchView(link.dataset.view);
    });
});

function switchView(view, profileId) {
    currentView = view;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`.nav-link[data-view="${view}"]`)?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');

    // Close notification dropdown when switching views
    document.getElementById('notif-dropdown').style.display = 'none';

    if (view === 'feed') loadFeed();
    else if (view === 'discover') loadDiscover();
    else if (view === 'search') loadSuggestions();
    else if (view === 'friends') loadFriends();
    else if (view === 'messages') loadMessages();
    else if (view === 'profile') loadProfile(profileId || currentUser.id);
}

// ============ INIT ============
async function initApp() {
    try {
        currentUser = await api('/api/me');
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('main-app').classList.add('active');

        // Set sidebar user
        const sidebarUser = document.getElementById('sidebar-user');
        sidebarUser.innerHTML = '';
        sidebarUser.appendChild(createAvatar(currentUser, 'avatar-sm'));
        const nameSpan = document.createElement('span');
        nameSpan.textContent = currentUser.display_name;
        sidebarUser.appendChild(nameSpan);

        // Set composer avatar
        const composerAvatar = document.getElementById('composer-avatar');
        composerAvatar.innerHTML = '';
        composerAvatar.appendChild(createAvatar(currentUser));

        switchView('feed');
        updateBadges();
        setInterval(updateBadges, 30000);
    } catch {
        // Not logged in
    }
}

async function updateBadges() {
    try {
        const [notifs, requests, msgs] = await Promise.all([
            api('/api/notifications/unread-count'),
            api('/api/friends/requests'),
            api('/api/messages-unread-count')
        ]);

        const notifBadge = document.getElementById('notif-badge');
        if (notifs.count > 0) {
            notifBadge.textContent = notifs.count;
            notifBadge.style.display = 'flex';
        } else {
            notifBadge.style.display = 'none';
        }

        const friendBadge = document.getElementById('friend-req-badge');
        if (requests.length > 0) {
            friendBadge.textContent = requests.length;
            friendBadge.style.display = 'flex';
        } else {
            friendBadge.style.display = 'none';
        }

        const msgBadge = document.getElementById('msg-badge');
        if (msgs.count > 0) {
            msgBadge.textContent = msgs.count;
            msgBadge.style.display = 'flex';
        } else {
            msgBadge.style.display = 'none';
        }
    } catch { }
}

// ============ NOTIFICATION BELL ============
document.getElementById('notif-bell-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'flex';
        loadNotifications();
    } else {
        dropdown.style.display = 'none';
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notif-bell-wrapper');
    if (!wrapper.contains(e.target)) {
        document.getElementById('notif-dropdown').style.display = 'none';
    }
});

// ============ FEED ============
async function loadFeed() {
    const container = document.getElementById('feed-posts');
    const emptyState = document.getElementById('feed-empty');

    try {
        const posts = await api('/api/posts/feed');
        container.innerHTML = '';

        if (posts.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            posts.forEach(post => container.appendChild(createPostCard(post)));
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Post button
document.getElementById('post-btn').addEventListener('click', submitPost);
document.getElementById('post-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPost();
    }
});

// Auto-resize textarea
document.getElementById('post-input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});

async function submitPost() {
    const input = document.getElementById('post-input');
    const fileInput = document.getElementById('post-image-input');
    const content = input.value.trim();
    const file = fileInput.files[0];

    if (!content && !file) return;

    try {
        const formData = new FormData();
        formData.append('content', content);
        if (file) formData.append('image', file);

        const res = await fetch('/api/posts', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong');

        input.value = '';
        input.style.height = 'auto';
        fileInput.value = '';
        document.getElementById('composer-preview').style.display = 'none';
        showToast('Post shared!');
        loadFeed();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Image preview in composer
document.getElementById('post-image-input').addEventListener('change', function () {
    const preview = document.getElementById('composer-preview');
    const previewImg = document.getElementById('composer-preview-img');
    if (this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(this.files[0]);
    }
});

document.getElementById('composer-preview-remove').addEventListener('click', () => {
    document.getElementById('post-image-input').value = '';
    document.getElementById('composer-preview').style.display = 'none';
});

function createPostCard(post) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.dataset.postId = post.id;

    const header = document.createElement('div');
    header.className = 'post-header';

    const avatar = createAvatar(post);
    avatar.style.cursor = 'pointer';
    avatar.addEventListener('click', () => switchView('profile', post.user_id));

    const userInfo = document.createElement('div');
    userInfo.className = 'post-user-info';
    userInfo.innerHTML = `
    <div class="name">${escapeHtml(post.display_name)}</div>
    <div class="username">@${escapeHtml(post.username)}</div>
  `;
    userInfo.querySelector('.name').addEventListener('click', () => switchView('profile', post.user_id));

    const time = document.createElement('span');
    time.className = 'post-time';
    time.textContent = timeAgo(post.created_at);

    header.append(avatar, userInfo, time);

    const content = document.createElement('div');
    content.className = 'post-content';
    content.innerHTML = linkifyContent(post.content);

    // Post image
    if (post.image_url) {
        const img = document.createElement('img');
        img.className = 'post-image';
        img.src = post.image_url;
        img.alt = 'Post image';
        img.loading = 'lazy';
        content.appendChild(img);
    }

    // Video embed
    const videoEmbed = getVideoEmbed(post.content);
    if (videoEmbed) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'post-video-embed';
        embedDiv.innerHTML = videoEmbed;
        content.appendChild(embedDiv);
    }

    const actions = document.createElement('div');
    actions.className = 'post-actions';

    // Like button
    const likeBtn = document.createElement('button');
    likeBtn.className = `post-action ${post.liked ? 'liked' : ''}`;
    likeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
    <span>${post.likes || 0}</span>
  `;
    likeBtn.addEventListener('click', async () => {
        try {
            const result = await api(`/api/posts/${post.id}/like`, { method: 'POST' });
            likeBtn.classList.toggle('liked', result.liked);
            likeBtn.querySelector('span').textContent = result.likeCount;
        } catch { }
    });

    // Comment toggle
    const commentBtn = document.createElement('button');
    commentBtn.className = 'post-action';
    commentBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    <span>${post.comment_count || 0}</span>
  `;
    commentBtn.addEventListener('click', () => toggleComments(card, post.id));

    actions.append(likeBtn, commentBtn);

    // Delete button for own posts
    if (post.user_id === currentUser.id) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'post-action post-delete';
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
        deleteBtn.addEventListener('click', async () => {
            if (confirm('Delete this post?')) {
                await api(`/api/posts/${post.id}`, { method: 'DELETE' });
                showToast('Post deleted');
                if (currentView === 'feed') loadFeed();
                else if (currentView === 'profile') loadProfile(currentProfileId || currentUser.id);
                else if (currentView === 'discover') loadDiscover();
            }
        });
        actions.appendChild(deleteBtn);
    }

    card.append(header, content, actions);
    return card;
}

async function toggleComments(card, postId) {
    let section = card.querySelector('.comments-section');
    if (section) {
        section.remove();
        return;
    }

    section = document.createElement('div');
    section.className = 'comments-section';

    try {
        const comments = await api(`/api/posts/${postId}/comments`);
        comments.forEach(c => section.appendChild(createCommentItem(c)));
    } catch { }

    // Comment form
    const form = document.createElement('div');
    form.className = 'comment-form';
    const input = document.createElement('input');
    input.placeholder = 'Write a comment...';
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            try {
                const comment = await api(`/api/posts/${postId}/comment`, {
                    method: 'POST',
                    body: { content: input.value.trim() }
                });
                section.insertBefore(createCommentItem(comment), form);
                input.value = '';
                // Update comment count on the button
                const countSpan = card.querySelectorAll('.post-action')[1].querySelector('span');
                countSpan.textContent = parseInt(countSpan.textContent) + 1;
                updateBadges();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });
    form.appendChild(createAvatar(currentUser, 'avatar-sm'));
    form.appendChild(input);
    section.appendChild(form);

    card.appendChild(section);
}

function createCommentItem(comment) {
    const item = document.createElement('div');
    item.className = 'comment-item';
    const avatar = createAvatar(comment, 'avatar-sm');
    avatar.style.cursor = 'pointer';
    avatar.addEventListener('click', () => switchView('profile', comment.user_id));

    const body = document.createElement('div');
    body.className = 'comment-body';
    body.innerHTML = `
    <div class="name">${escapeHtml(comment.display_name)}</div>
    <div class="text">${escapeHtml(comment.content)}</div>
    <div class="time">${timeAgo(comment.created_at)}</div>
  `;
    body.querySelector('.name').addEventListener('click', () => switchView('profile', comment.user_id));

    item.append(avatar, body);

    if (comment.user_id === currentUser.id) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'comment-delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Delete comment';
        deleteBtn.addEventListener('click', async () => {
            await api(`/api/comments/${comment.id}`, { method: 'DELETE' });
            item.remove();
            showToast('Comment deleted');
        });
        item.appendChild(deleteBtn);
    }

    return item;
}

// ============ SEARCH ============
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query.length === 0) {
        document.getElementById('search-results').innerHTML = '';
        document.getElementById('suggestions-section').style.display = 'block';
        return;
    }

    document.getElementById('suggestions-section').style.display = 'none';
    searchTimeout = setTimeout(async () => {
        try {
            const users = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
            const container = document.getElementById('search-results');
            container.innerHTML = '';
            users.forEach(user => container.appendChild(createUserCard(user)));

            if (users.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No users found</p></div>';
            }
        } catch { }
    }, 300);
});

async function loadSuggestions() {
    try {
        const users = await api('/api/friends/suggestions');
        const container = document.getElementById('suggestions-list');
        container.innerHTML = '';
        users.forEach(user => container.appendChild(createUserCard(user)));

        if (users.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No suggestions right now</p></div>';
        }
    } catch { }
}

function createUserCard(user, options = {}) {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return;
        switchView('profile', user.id);
    });

    const avatar = createAvatar(user);
    const info = document.createElement('div');
    info.className = 'user-card-info';
    info.innerHTML = `
    <div class="name">${escapeHtml(user.display_name)}</div>
    <div class="username">@${escapeHtml(user.username)}</div>
    ${user.bio ? `<div class="bio">${escapeHtml(user.bio)}</div>` : ''}
  `;

    const actions = document.createElement('div');
    actions.className = 'user-card-actions';

    if (options.showAcceptDecline) {
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'btn btn-success btn-sm';
        acceptBtn.textContent = 'Accept';
        acceptBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api(`/api/friends/accept/${user.id}`, { method: 'POST' });
            showToast(`You and ${user.display_name} are now friends!`);
            loadFriends();
            updateBadges();
        });

        const declineBtn = document.createElement('button');
        declineBtn.className = 'btn btn-danger btn-sm';
        declineBtn.textContent = 'Decline';
        declineBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api(`/api/friends/decline/${user.id}`, { method: 'POST' });
            card.remove();
            updateBadges();
        });

        actions.append(acceptBtn, declineBtn);
    } else if (options.showRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-secondary btn-sm';
        removeBtn.textContent = 'Unfriend';
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api(`/api/friends/${user.id}`, { method: 'DELETE' });
            showToast('Friend removed');
            loadFriends();
            updateBadges();
        });
        actions.appendChild(removeBtn);

        if (isOnline(user.last_seen)) {
            const dot = document.createElement('div');
            dot.className = 'online-dot';
            dot.title = 'Online';
            info.querySelector('.name').prepend(dot);
            info.querySelector('.name').style.display = 'flex';
            info.querySelector('.name').style.alignItems = 'center';
            info.querySelector('.name').style.gap = '8px';
        }
    }

    card.append(avatar, info, actions);
    return card;
}

// ============ DISCOVER ============
async function loadDiscover() {
    try {
        const [trending, popular, newMembers] = await Promise.all([
            api('/api/discover/trending'),
            api('/api/discover/popular-users'),
            api('/api/discover/new-members')
        ]);

        // Trending posts
        const trendingEl = document.getElementById('trending-posts');
        trendingEl.innerHTML = '';
        if (trending.length === 0) {
            trendingEl.innerHTML = '<div class="empty-state"><p>No trending posts yet. Be the first to post!</p></div>';
        } else {
            trending.forEach(post => trendingEl.appendChild(createPostCard(post)));
        }

        // Popular users
        const popularEl = document.getElementById('popular-users');
        popularEl.innerHTML = '';
        popular.forEach(user => {
            const card = document.createElement('div');
            card.className = 'discover-user-card';
            card.addEventListener('click', () => switchView('profile', user.id));
            const avatar = createAvatar(user);
            const info = document.createElement('div');
            info.className = 'discover-user-info';
            info.innerHTML = `
                <div class="name">${escapeHtml(user.display_name)}</div>
                <div class="meta">${user.friend_count} friends · ${user.post_count} posts</div>
            `;
            card.append(avatar, info);
            popularEl.appendChild(card);
        });
        if (popular.length === 0) {
            popularEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>No users yet</p></div>';
        }

        // New members
        const newEl = document.getElementById('new-members');
        newEl.innerHTML = '';
        newMembers.forEach(user => {
            const card = document.createElement('div');
            card.className = 'discover-user-card';
            card.addEventListener('click', () => switchView('profile', user.id));
            const avatar = createAvatar(user);
            const info = document.createElement('div');
            info.className = 'discover-user-info';
            info.innerHTML = `
                <div class="name">${escapeHtml(user.display_name)}</div>
                <div class="meta">Joined ${timeAgo(user.created_at)}</div>
            `;
            card.append(avatar, info);
            newEl.appendChild(card);
        });
        if (newMembers.length === 0) {
            newEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>No new members</p></div>';
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============ FRIENDS ============
async function loadFriends() {
    try {
        const [friends, requests] = await Promise.all([
            api('/api/friends'),
            api('/api/friends/requests')
        ]);

        // Requests
        const reqSection = document.getElementById('friend-requests-section');
        const reqList = document.getElementById('friend-requests-list');
        reqList.innerHTML = '';

        if (requests.length > 0) {
            reqSection.style.display = 'block';
            requests.forEach(user => reqList.appendChild(createUserCard(user, { showAcceptDecline: true })));
        } else {
            reqSection.style.display = 'none';
        }

        // Friends
        const friendsList = document.getElementById('friends-list');
        const emptyState = document.getElementById('friends-empty');
        friendsList.innerHTML = '';

        if (friends.length > 0) {
            emptyState.style.display = 'none';
            friends.forEach(user => friendsList.appendChild(createUserCard(user, { showRemove: true })));
        } else {
            emptyState.style.display = 'block';
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============ MESSAGES ============
let currentChatUserId = null;
let messageRefreshInterval = null;

async function loadMessages() {
    try {
        const conversations = await api('/api/messages/conversations');
        const container = document.getElementById('conversations-list');
        const emptyState = document.getElementById('conversations-empty');
        const searchResults = document.getElementById('dm-search-results');
        searchResults.style.display = 'none';

        if (conversations.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            container.innerHTML = conversations.map(c => `
                <div class="conversation-item ${c.id === currentChatUserId ? 'active' : ''}" data-user-id="${c.id}">
                    ${createAvatarHTML(c)}
                    <div class="conv-info">
                        <div class="conv-name">${escapeHtml(c.display_name)}</div>
                        <div class="conv-preview">${c.sender_id === currentUser.id ? 'You: ' : ''}${escapeHtml(c.last_message.substring(0, 40))}</div>
                    </div>
                    <div class="conv-meta">
                        <span class="conv-time">${formatTime(c.last_message_at)}</span>
                        ${c.unread_count > 0 ? `<span class="conv-unread">${c.unread_count}</span>` : ''}
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.conversation-item').forEach(item => {
                item.addEventListener('click', () => openChat(parseInt(item.dataset.userId)));
            });
        }
    } catch (err) {
        console.error('Failed to load conversations:', err);
    }
}

async function openChat(userId) {
    currentChatUserId = userId;
    const chatPanel = document.getElementById('chat-panel');
    const messagesContainer = document.querySelector('.messages-container');
    chatPanel.style.display = 'flex';
    messagesContainer.classList.add('chat-open');

    // Mark active conversation
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.toggle('active', parseInt(item.dataset.userId) === userId);
    });

    // Load user info for header
    try {
        const user = await api(`/api/users/${userId}`);
        document.getElementById('chat-header').innerHTML = `
            <button class="chat-back-btn" onclick="closeChat()">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>
            ${createAvatarHTML(user)}
            <div>
                <div class="chat-user-name">${escapeHtml(user.display_name)}</div>
                <div class="chat-username">@${escapeHtml(user.username)}</div>
            </div>
        `;
    } catch { }

    await loadChatMessages(userId);

    // Auto-refresh messages
    if (messageRefreshInterval) clearInterval(messageRefreshInterval);
    messageRefreshInterval = setInterval(() => loadChatMessages(userId), 3000);
}

function closeChat() {
    currentChatUserId = null;
    const messagesContainer = document.querySelector('.messages-container');
    messagesContainer.classList.remove('chat-open');
    document.getElementById('chat-panel').style.display = 'none';
    if (messageRefreshInterval) {
        clearInterval(messageRefreshInterval);
        messageRefreshInterval = null;
    }
}

async function loadChatMessages(userId) {
    try {
        const messages = await api(`/api/messages/${userId}`);
        const container = document.getElementById('chat-messages');
        container.innerHTML = messages.map(m => `
            <div class="message-bubble ${m.sender_id === currentUser.id ? 'sent' : 'received'}">
                <div>${escapeHtml(m.content)}</div>
                <div class="msg-time">${formatTime(m.created_at)}</div>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.error('Failed to load messages:', err);
    }
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content || !currentChatUserId) return;

    try {
        await api(`/api/messages/${currentChatUserId}`, {
            method: 'POST',
            body: { content }
        });
        input.value = '';
        await loadChatMessages(currentChatUserId);
        loadMessages(); // Refresh conversation list
    } catch (err) {
        console.error('Failed to send message:', err);
    }
}

function createAvatarHTML(user) {
    if (user.avatar_url) {
        return `<img src="${user.avatar_url}" class="avatar-sm" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
    }
    const initial = (user.display_name || user.username || '?')[0].toUpperCase();
    return `<div class="avatar-sm" style="width:36px;height:36px;border-radius:50%;background:${user.avatar_color || '#6366f1'};display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:14px;">${initial}</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(dateStr) {
    const date = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd';
    return date.toLocaleDateString();
}

// DM search
document.getElementById('dm-search-input').addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    const resultsDiv = document.getElementById('dm-search-results');
    if (query.length < 1) {
        resultsDiv.style.display = 'none';
        return;
    }
    try {
        const users = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = users.map(u => `
            <div class="conversation-item" data-user-id="${u.id}">
                ${createAvatarHTML(u)}
                <div class="conv-info">
                    <div class="conv-name">${escapeHtml(u.display_name)}</div>
                    <div class="conv-preview">@${escapeHtml(u.username)}</div>
                </div>
            </div>
        `).join('');
        resultsDiv.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                resultsDiv.style.display = 'none';
                document.getElementById('dm-search-input').value = '';
                openChat(parseInt(item.dataset.userId));
            });
        });
    } catch { }
});

// Send message handlers
document.getElementById('send-message-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// ============ NOTIFICATIONS ============
async function loadNotifications() {
    try {
        const notifications = await api('/api/notifications');
        const container = document.getElementById('notifications-list');
        const emptyState = document.getElementById('notif-empty');
        container.innerHTML = '';

        if (notifications.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            notifications.forEach(n => {
                const item = document.createElement('div');
                item.className = `notification-item ${n.is_read ? '' : 'unread'}`;

                const avatar = createAvatar(n);
                const text = document.createElement('div');
                text.className = 'notification-text';

                let message = '';
                if (n.type === 'friend_request') {
                    message = `<strong>${escapeHtml(n.display_name)}</strong> sent you a friend request`;
                } else if (n.type === 'friend_accepted') {
                    message = `<strong>${escapeHtml(n.display_name)}</strong> accepted your friend request`;
                } else if (n.type === 'like') {
                    message = `<strong>${escapeHtml(n.display_name)}</strong> liked your post`;
                } else if (n.type === 'comment') {
                    message = `<strong>${escapeHtml(n.display_name)}</strong> commented on your post`;
                }
                text.innerHTML = message;

                const time = document.createElement('span');
                time.className = 'notification-time';
                time.textContent = timeAgo(n.created_at);

                item.append(avatar, text, time);
                item.addEventListener('click', () => {
                    if (n.type === 'friend_request' || n.type === 'friend_accepted') {
                        switchView('profile', n.from_user_id);
                    }
                });

                container.appendChild(item);
            });
        }

        // Mark all as read
        await api('/api/notifications/read', { method: 'POST' });
        updateBadges();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============ PROFILE ============
async function loadProfile(userId) {
    currentProfileId = userId;
    const headerEl = document.getElementById('profile-header');
    const postsEl = document.getElementById('profile-posts');

    try {
        const [user, posts] = await Promise.all([
            api(`/api/users/${userId}`),
            api(`/api/posts/user/${userId}`)
        ]);

        // Generate gradient cover
        const gradients = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
        ];
        const gradient = gradients[userId % gradients.length];
        const coverStyle = user.banner_url
            ? `background: url('${user.banner_url}') center/cover no-repeat`
            : `background: ${gradient}`;

        const avatarHtml = user.avatar_url
            ? `<img class="avatar avatar-xl" src="${user.avatar_url}" alt="${escapeHtml(user.display_name)}" style="object-fit:cover; border: 4px solid var(--bg-secondary)">`
            : `<div class="avatar avatar-xl" style="background: ${user.avatar_color}; border: 4px solid var(--bg-secondary)">${(user.display_name)[0].toUpperCase()}</div>`;

        headerEl.innerHTML = `
      <div class="profile-cover" style="${coverStyle}"></div>
      <div class="profile-info">
        ${avatarHtml}
        <div class="profile-details">
          <div class="name">${escapeHtml(user.display_name)}</div>
          <div class="username">@${escapeHtml(user.username)}</div>
        </div>
      </div>
      ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : '<div class="profile-bio" style="color:var(--text-muted);font-style:italic">No bio yet</div>'}
      <div class="profile-stats">
        <div class="profile-stat"><div class="value">${user.postCount}</div><div class="label">Posts</div></div>
        <div class="profile-stat"><div class="value">${user.friendCount}</div><div class="label">Friends</div></div>
      </div>
      <div class="profile-actions" id="profile-actions"></div>
    `;

        const actionsEl = document.getElementById('profile-actions');

        if (user.isOwnProfile) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary';
            editBtn.textContent = 'Edit Profile';
            editBtn.addEventListener('click', () => showEditProfileModal(user));
            actionsEl.appendChild(editBtn);
        } else {
            const friendship = user.friendship;

            if (!friendship) {
                const addBtn = document.createElement('button');
                addBtn.className = 'btn btn-primary';
                addBtn.textContent = 'Add Friend';
                addBtn.addEventListener('click', async () => {
                    await api(`/api/friends/request/${userId}`, { method: 'POST' });
                    showToast('Friend request sent!');
                    loadProfile(userId);
                });
                actionsEl.appendChild(addBtn);
            } else if (friendship.status === 'pending' && friendship.addressee_id === currentUser.id) {
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'btn btn-success';
                acceptBtn.textContent = 'Accept Request';
                acceptBtn.addEventListener('click', async () => {
                    await api(`/api/friends/accept/${userId}`, { method: 'POST' });
                    showToast('Friend request accepted!');
                    loadProfile(userId);
                });

                const declineBtn = document.createElement('button');
                declineBtn.className = 'btn btn-danger';
                declineBtn.textContent = 'Decline';
                declineBtn.addEventListener('click', async () => {
                    await api(`/api/friends/decline/${userId}`, { method: 'POST' });
                    loadProfile(userId);
                });

                actionsEl.append(acceptBtn, declineBtn);
            } else if (friendship.status === 'pending') {
                const pendingBtn = document.createElement('button');
                pendingBtn.className = 'btn btn-secondary';
                pendingBtn.textContent = 'Request Sent';
                pendingBtn.disabled = true;
                actionsEl.appendChild(pendingBtn);
            } else if (friendship.status === 'accepted') {
                const friendsLabel = document.createElement('button');
                friendsLabel.className = 'btn btn-secondary';
                friendsLabel.textContent = '✓ Friends';
                actionsEl.appendChild(friendsLabel);

                const unfriendBtn = document.createElement('button');
                unfriendBtn.className = 'btn btn-danger';
                unfriendBtn.textContent = 'Unfriend';
                unfriendBtn.addEventListener('click', async () => {
                    if (confirm('Remove this friend?')) {
                        await api(`/api/friends/${userId}`, { method: 'DELETE' });
                        showToast('Friend removed');
                        loadProfile(userId);
                    }
                });
                actionsEl.appendChild(unfriendBtn);
            }
        }

        // Posts
        postsEl.innerHTML = '';
        if (posts.length === 0) {
            postsEl.innerHTML = '<div class="empty-state"><h3>No posts yet</h3></div>';
        } else {
            posts.forEach(post => postsEl.appendChild(createPostCard(post)));
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showEditProfileModal(user) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
    <h3>Edit Profile</h3>
    <div class="form-group">
      <label>Profile Picture</label>
      <div class="upload-row">
        <div class="upload-preview" id="avatar-preview">
          ${user.avatar_url
            ? `<img src="${user.avatar_url}" alt="avatar">`
            : `<div class="avatar avatar-lg" style="background:${user.avatar_color}">${(user.display_name)[0].toUpperCase()}</div>`
        }
        </div>
        <label class="btn btn-secondary btn-sm upload-btn">
          Change Photo
          <input type="file" id="edit-avatar" accept="image/*" hidden>
        </label>
      </div>
    </div>
    <div class="form-group">
      <label>Banner Image</label>
      <div class="upload-banner-preview" id="banner-preview">
        ${user.banner_url
            ? `<img src="${user.banner_url}" alt="banner">`
            : '<span class="upload-placeholder">No banner set</span>'
        }
      </div>
      <label class="btn btn-secondary btn-sm upload-btn" style="margin-top:8px">
        Change Banner
        <input type="file" id="edit-banner" accept="image/*" hidden>
      </label>
    </div>
    <div class="form-group">
      <label>Display Name</label>
      <input type="text" id="edit-displayname" value="${escapeHtml(user.display_name)}" maxlength="50">
    </div>
    <div class="form-group">
      <label>Bio</label>
      <textarea id="edit-bio" rows="3" maxlength="200" placeholder="Tell people about yourself...">${escapeHtml(user.bio || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="edit-cancel">Cancel</button>
      <button class="btn btn-primary" id="edit-save">Save Changes</button>
    </div>
  `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('edit-cancel').addEventListener('click', () => overlay.remove());

    // Avatar upload preview
    document.getElementById('edit-avatar').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('avatar-preview').innerHTML = `<img src="${ev.target.result}" alt="avatar">`;
            };
            reader.readAsDataURL(file);
        }
    });

    // Banner upload preview
    document.getElementById('edit-banner').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('banner-preview').innerHTML = `<img src="${ev.target.result}" alt="banner">`;
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('edit-save').addEventListener('click', async () => {
        try {
            // Upload avatar if changed
            const avatarFile = document.getElementById('edit-avatar').files[0];
            if (avatarFile) {
                const avatarData = new FormData();
                avatarData.append('avatar', avatarFile);
                await fetch('/api/users/avatar', { method: 'POST', body: avatarData });
            }

            // Upload banner if changed
            const bannerFile = document.getElementById('edit-banner').files[0];
            if (bannerFile) {
                const bannerData = new FormData();
                bannerData.append('banner', bannerFile);
                await fetch('/api/users/banner', { method: 'POST', body: bannerData });
            }

            await api('/api/users/profile', {
                method: 'PUT',
                body: {
                    displayName: document.getElementById('edit-displayname').value,
                    bio: document.getElementById('edit-bio').value
                }
            });
            overlay.remove();
            showToast('Profile updated!');
            currentUser = await api('/api/me');

            // Update sidebar
            const sidebarUser = document.getElementById('sidebar-user');
            sidebarUser.innerHTML = '';
            sidebarUser.appendChild(createAvatar(currentUser, 'avatar-sm'));
            const nameSpan = document.createElement('span');
            nameSpan.textContent = currentUser.display_name;
            sidebarUser.appendChild(nameSpan);

            loadProfile(currentUser.id);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ============ TUTORIAL ============
function showTutorial() {
    document.getElementById('tutorial-overlay').style.display = 'flex';
}

function nextTutorialStep(step) {
    document.querySelectorAll('.tutorial-step').forEach(s => s.style.display = 'none');
    document.getElementById(`tutorial-step-${step}`).style.display = 'block';
    document.querySelectorAll('.tutorial-dot').forEach(d => d.classList.remove('active'));
    document.querySelector(`.tutorial-dot[data-step="${step}"]`).classList.add('active');
}

function closeTutorial() {
    document.getElementById('tutorial-overlay').style.display = 'none';
}

// ============ BOOT ============
initApp();
