const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { initDatabase, queryAll, queryOne, runSql } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists (use persistent disk if available)
const uploadsDir = process.env.DB_DIR
    ? path.join(process.env.DB_DIR, 'uploads')
    : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer config for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${req.session.userId}-${file.fieldname}-${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    }
});

// Persistent session secret (survives restarts)
function getSessionSecret() {
    const dataDir = process.env.DB_DIR || __dirname;
    const secretPath = path.join(dataDir, '.session-secret');
    if (fs.existsSync(secretPath)) {
        return fs.readFileSync(secretPath, 'utf8').trim();
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, secret);
    return secret;
}

// Middleware
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    runSql('UPDATE users SET last_seen = datetime("now") WHERE id = ?', [req.session.userId]);
    next();
}

// ============ AUTH ROUTES ============

app.post('/api/register', (req, res) => {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password || !displayName) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    try {
        const hash = bcrypt.hashSync(password, 10);
        const result = runSql(
            'INSERT INTO users (username, email, password, display_name, avatar_color) VALUES (?, ?, ?, ?, ?)',
            [username.toLowerCase(), email.toLowerCase(), hash, displayName, avatarColor]
        );

        req.session.userId = result.lastInsertRowid;
        res.json({ success: true, userId: result.lastInsertRowid });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username or email already taken' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const user = queryOne('SELECT * FROM users WHERE username = ? OR email = ?',
        [username.toLowerCase(), username.toLowerCase()]);

    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    runSql('UPDATE users SET last_seen = datetime("now") WHERE id = ?', [user.id]);
    res.json({ success: true, userId: user.id });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    const user = queryOne(
        'SELECT id, username, email, display_name, bio, avatar_color, avatar_url, banner_url, created_at FROM users WHERE id = ?',
        [req.session.userId]
    );
    res.json(user);
});

// ============ USER ROUTES ============

app.get('/api/users/search', requireAuth, (req, res) => {
    const query = req.query.q;
    if (!query || query.length < 1) return res.json([]);

    const users = queryAll(
        `SELECT id, username, display_name, bio, avatar_color, avatar_url, last_seen
     FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) LIMIT 20`,
        [req.session.userId, `%${query}%`, `%${query}%`]
    );
    res.json(users);
});

app.get('/api/users/:id', requireAuth, (req, res) => {
    const userId = parseInt(req.params.id);
    const user = queryOne(
        'SELECT id, username, display_name, bio, avatar_color, avatar_url, banner_url, created_at, last_seen FROM users WHERE id = ?',
        [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const friendship = queryOne(
        `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        [req.session.userId, userId, userId, req.session.userId]
    );

    const postCount = queryOne('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [userId]);
    const friendCount = queryOne(
        `SELECT COUNT(*) as count FROM friendships
     WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
        [userId, userId]
    );

    res.json({
        ...user,
        friendship: friendship || null,
        postCount: postCount?.count || 0,
        friendCount: friendCount?.count || 0,
        isOwnProfile: userId === req.session.userId
    });
});

app.put('/api/users/profile', requireAuth, (req, res) => {
    const { displayName, bio } = req.body;

    if (displayName !== undefined && displayName.length > 50) {
        return res.status(400).json({ error: 'Display name too long' });
    }
    if (bio !== undefined && bio.length > 200) {
        return res.status(400).json({ error: 'Bio too long' });
    }

    if (displayName) {
        runSql('UPDATE users SET display_name = ? WHERE id = ?', [displayName, req.session.userId]);
    }
    if (bio !== undefined) {
        runSql('UPDATE users SET bio = ? WHERE id = ?', [bio, req.session.userId]);
    }
    res.json({ success: true });
});

// Upload avatar
app.post('/api/users/avatar', requireAuth, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    // Delete old avatar file
    const old = queryOne('SELECT avatar_url FROM users WHERE id = ?', [req.session.userId]);
    if (old?.avatar_url) {
        const oldPath = path.join(__dirname, 'public', old.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    runSql('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.session.userId]);
    res.json({ success: true, avatar_url: avatarUrl });
});

// Upload banner
app.post('/api/users/banner', requireAuth, upload.single('banner'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const bannerUrl = `/uploads/${req.file.filename}`;
    // Delete old banner file
    const old = queryOne('SELECT banner_url FROM users WHERE id = ?', [req.session.userId]);
    if (old?.banner_url) {
        const oldPath = path.join(__dirname, 'public', old.banner_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    runSql('UPDATE users SET banner_url = ? WHERE id = ?', [bannerUrl, req.session.userId]);
    res.json({ success: true, banner_url: bannerUrl });
});

// ============ FRIEND ROUTES ============

app.post('/api/friends/request/:userId', requireAuth, (req, res) => {
    const addresseeId = parseInt(req.params.userId);
    if (addresseeId === req.session.userId) {
        return res.status(400).json({ error: "Can't friend yourself" });
    }

    const existing = queryOne(
        `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        [req.session.userId, addresseeId, addresseeId, req.session.userId]
    );
    if (existing) {
        return res.status(400).json({ error: 'Friendship already exists or pending' });
    }

    runSql('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)',
        [req.session.userId, addresseeId]);
    runSql('INSERT INTO notifications (user_id, from_user_id, type, reference_id) VALUES (?, ?, ?, ?)',
        [addresseeId, req.session.userId, 'friend_request', req.session.userId]);

    res.json({ success: true });
});

app.post('/api/friends/accept/:userId', requireAuth, (req, res) => {
    const requesterId = parseInt(req.params.userId);
    const result = runSql(
        `UPDATE friendships SET status = 'accepted', updated_at = datetime("now")
     WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
        [requesterId, req.session.userId]
    );

    if (result.changes === 0) {
        return res.status(404).json({ error: 'No pending request found' });
    }

    runSql('INSERT INTO notifications (user_id, from_user_id, type, reference_id) VALUES (?, ?, ?, ?)',
        [requesterId, req.session.userId, 'friend_accepted', req.session.userId]);

    res.json({ success: true });
});

app.post('/api/friends/decline/:userId', requireAuth, (req, res) => {
    runSql(
        `DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
        [parseInt(req.params.userId), req.session.userId]
    );
    res.json({ success: true });
});

app.delete('/api/friends/:userId', requireAuth, (req, res) => {
    const friendId = parseInt(req.params.userId);
    runSql(
        `DELETE FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        [req.session.userId, friendId, friendId, req.session.userId]
    );
    res.json({ success: true });
});

app.get('/api/friends', requireAuth, (req, res) => {
    const friends = queryAll(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_color, u.avatar_url, u.last_seen,
            f.created_at as friends_since
     FROM friendships f
     JOIN users u ON (u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END)
     WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
     ORDER BY u.last_seen DESC`,
        [req.session.userId, req.session.userId, req.session.userId]
    );
    res.json(friends);
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
    const requests = queryAll(
        `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, f.created_at
     FROM friendships f JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id = ? AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
        [req.session.userId]
    );
    res.json(requests);
});

app.get('/api/friends/suggestions', requireAuth, (req, res) => {
    const suggestions = queryAll(
        `SELECT id, username, display_name, bio, avatar_color, avatar_url FROM users
     WHERE id != ? AND id NOT IN (
       SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
       FROM friendships WHERE requester_id = ? OR addressee_id = ?
     ) ORDER BY RANDOM() LIMIT 5`,
        [req.session.userId, req.session.userId, req.session.userId, req.session.userId]
    );
    res.json(suggestions);
});

// ============ POST ROUTES ============

app.post('/api/posts', requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Post content is required' });
    }
    if (content.length > 1000) {
        return res.status(400).json({ error: 'Post too long (max 1000 characters)' });
    }

    const result = runSql('INSERT INTO posts (user_id, content) VALUES (?, ?)',
        [req.session.userId, content.trim()]);

    const post = queryOne(
        `SELECT p.*, u.username, u.display_name, u.avatar_color, u.avatar_url
     FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
        [result.lastInsertRowid]
    );

    res.json({ ...post, likes: 0, comments: [], liked: false, comment_count: 0 });
});

app.get('/api/posts/feed', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const posts = queryAll(
        `SELECT p.*, u.username, u.display_name, u.avatar_color, u.avatar_url,
       (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
       (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
       (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as liked
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ? OR p.user_id IN (
       SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
       FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
     )
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
        [req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, limit, offset]
    );
    res.json(posts);
});

app.get('/api/posts/user/:userId', requireAuth, (req, res) => {
    const posts = queryAll(
        `SELECT p.*, u.username, u.display_name, u.avatar_color, u.avatar_url,
       (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
       (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
       (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as liked
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ? ORDER BY p.created_at DESC`,
        [req.session.userId, parseInt(req.params.userId)]
    );
    res.json(posts);
});

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const existing = queryOne('SELECT * FROM likes WHERE user_id = ? AND post_id = ?',
        [req.session.userId, postId]);

    if (existing) {
        runSql('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [req.session.userId, postId]);
        const count = queryOne('SELECT COUNT(*) as c FROM likes WHERE post_id = ?', [postId]);
        res.json({ liked: false, likeCount: count.c });
    } else {
        runSql('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.session.userId, postId]);

        const post = queryOne('SELECT user_id FROM posts WHERE id = ?', [postId]);
        if (post && post.user_id !== req.session.userId) {
            runSql('INSERT INTO notifications (user_id, from_user_id, type, reference_id) VALUES (?, ?, ?, ?)',
                [post.user_id, req.session.userId, 'like', postId]);
        }
        const count = queryOne('SELECT COUNT(*) as c FROM likes WHERE post_id = ?', [postId]);
        res.json({ liked: true, likeCount: count.c });
    }
});

app.post('/api/posts/:id/comment', requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Comment cannot be empty' });
    }
    if (content.length > 500) {
        return res.status(400).json({ error: 'Comment too long' });
    }

    const postId = parseInt(req.params.id);
    const result = runSql('INSERT INTO comments (user_id, post_id, content) VALUES (?, ?, ?)',
        [req.session.userId, postId, content.trim()]);

    const comment = queryOne(
        `SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
     FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
        [result.lastInsertRowid]
    );

    const post = queryOne('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (post && post.user_id !== req.session.userId) {
        runSql('INSERT INTO notifications (user_id, from_user_id, type, reference_id) VALUES (?, ?, ?, ?)',
            [post.user_id, req.session.userId, 'comment', postId]);
    }

    res.json(comment);
});

app.get('/api/posts/:id/comments', requireAuth, (req, res) => {
    const comments = queryAll(
        `SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
     FROM comments c JOIN users u ON c.user_id = u.id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`,
        [parseInt(req.params.id)]
    );
    res.json(comments);
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
    runSql('DELETE FROM posts WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.session.userId]);
    res.json({ success: true });
});

// ============ NOTIFICATION ROUTES ============

app.get('/api/notifications', requireAuth, (req, res) => {
    const notifications = queryAll(
        `SELECT n.*, u.username, u.display_name, u.avatar_color, u.avatar_url
     FROM notifications n JOIN users u ON n.from_user_id = u.id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 30`,
        [req.session.userId]
    );
    res.json(notifications);
});

app.get('/api/notifications/unread-count', requireAuth, (req, res) => {
    const result = queryOne(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
        [req.session.userId]
    );
    res.json({ count: result?.count || 0 });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
    runSql('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.userId]);
    res.json({ success: true });
});

// ============ DISCOVER ROUTES ============

app.get('/api/discover/trending', requireAuth, (req, res) => {
    const posts = queryAll(
        `SELECT p.*, u.username, u.display_name, u.avatar_color, u.avatar_url,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as liked
         FROM posts p JOIN users u ON p.user_id = u.id
         WHERE p.created_at > datetime('now', '-7 days')
         ORDER BY likes DESC, comment_count DESC
         LIMIT 20`,
        [req.session.userId]
    );
    res.json(posts);
});

app.get('/api/discover/popular-users', requireAuth, (req, res) => {
    const users = queryAll(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_color,
           (SELECT COUNT(*) FROM friendships WHERE (requester_id = u.id OR addressee_id = u.id) AND status = 'accepted') as friend_count,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count
         FROM users u
         WHERE u.id != ?
         ORDER BY friend_count DESC, post_count DESC
         LIMIT 6`,
        [req.session.userId]
    );
    res.json(users);
});

app.get('/api/discover/new-members', requireAuth, (req, res) => {
    const users = queryAll(
        `SELECT id, username, display_name, bio, avatar_color, avatar_url, created_at
         FROM users
         WHERE id != ?
         ORDER BY created_at DESC
         LIMIT 6`,
        [req.session.userId]
    );
    res.json(users);
});

// ============ MESSAGES ROUTES ============

// Get conversations list (most recent message from each user)
app.get('/api/messages/conversations', requireAuth, (req, res) => {
    const conversations = queryAll(
        `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url,
            m.content as last_message, m.created_at as last_message_at, m.sender_id,
            (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
         FROM users u
         INNER JOIN messages m ON m.id = (
            SELECT id FROM messages
            WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?)
            ORDER BY created_at DESC LIMIT 1
         )
         WHERE u.id != ?
         ORDER BY m.created_at DESC`,
        [req.session.userId, req.session.userId, req.session.userId, req.session.userId]
    );
    res.json(conversations);
});

// Get messages with a specific user
app.get('/api/messages/:userId', requireAuth, (req, res) => {
    const otherId = parseInt(req.params.userId);
    const messages = queryAll(
        `SELECT m.*, u.username, u.display_name, u.avatar_color, u.avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY m.created_at ASC`,
        [req.session.userId, otherId, otherId, req.session.userId]
    );
    // Mark as read
    runSql('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [otherId, req.session.userId]);
    res.json(messages);
});

// Send a message
app.post('/api/messages/:userId', requireAuth, (req, res) => {
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Message cannot be empty' });
    }
    if (receiverId === req.session.userId) {
        return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const result = runSql(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
        [req.session.userId, receiverId, content.trim()]
    );
    res.json({ success: true, messageId: result.lastInsertRowid });
});

// Get unread message count
app.get('/api/messages-unread-count', requireAuth, (req, res) => {
    const result = queryOne(
        'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0',
        [req.session.userId]
    );
    res.json({ count: result.count });
});

// Look up user by username
app.get('/api/users/lookup/:username', requireAuth, (req, res) => {
    const user = queryOne(
        'SELECT id, username, display_name, bio, avatar_color, avatar_url, banner_url, created_at FROM users WHERE username = ?',
        [req.params.username.toLowerCase()]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// Serve the SPA
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after database is ready
initDatabase().then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Echo Connect running on port ${PORT}`);
    });
    server.on('error', (err) => {
        console.error('Server error:', err.message);
        process.exit(1);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
