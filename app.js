
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRY = '24h';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));


// API Info endpoint
app.get('/api', (req, res) => {
    res.json({
        name: 'UniCollab API',
        version: '1.0.0',
        status: 'online',
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                me: 'GET /api/auth/me'
            },
            projects: {
                list: 'GET /api/projects',
                get: 'GET /api/projects/:id',
                create: 'POST /api/projects',
                update: 'PUT /api/projects/:id',
                like: 'POST /api/projects/:id/like',
                collaborate: 'POST /api/projects/:id/collaborate'
            },
            profile: {
                get: 'GET /api/profile/:userId',
                update: 'PUT /api/profile'
            },
            stats: 'GET /api/stats'
        },
        documentation: 'http://localhost:5000',
        base_url: 'http://localhost:5000/api'
    });
});

// ==================== SQLITE DATABASE SETUP ====================
const db = new sqlite3.Database('./unicollab.db');

// Helper to promisify db methods
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, result) => err ? reject(err) : resolve(result));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// Initialize database tables
const initDatabase = async () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
                name VARCHAR(120) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                university VARCHAR(200),
                department VARCHAR(100),
                bio TEXT,
                role VARCHAR(20) DEFAULT 'student',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Projects table
            db.run(`CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                category VARCHAR(80),
                status VARCHAR(20) DEFAULT 'Open',
                tech_stack TEXT,
                university VARCHAR(200),
                department VARCHAR(100),
                author VARCHAR(120) NOT NULL,
                author_id TEXT,
                likes_count INT DEFAULT 0,
                views_count INT DEFAULT 0,
                open_collab BOOLEAN DEFAULT 1,
                github_url TEXT,
                demo_url TEXT,
                team_size INT DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
            )`);

            // Collaborations table
            db.run(`CREATE TABLE IF NOT EXISTS collaborations (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
                project_id TEXT,
                requester_id TEXT,
                message TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(project_id, requester_id)
            )`);

            // Project likes table
            db.run(`CREATE TABLE IF NOT EXISTS project_likes (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
                project_id TEXT,
                user_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(project_id, user_id)
            )`);

            // Create indexes
            db.run(`CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

            // Insert sample data if empty
            db.get(`SELECT COUNT(*) as count FROM users`, async (err, result) => {
                if (err) reject(err);
                else if (result.count === 0) {
                    await insertSampleData();
                    resolve();
                } else resolve();
            });
        });
    });
};

// Sample data insertion
const insertSampleData = async () => {
    const hashedPassword = await bcrypt.hash('pass123', 10);
    const adminPassword = await bcrypt.hash('admin123', 10);
    
    const users = [
        ['Arjun Mehta', 'arjun@iitd.ac.in', hashedPassword, 'IIT Delhi', 'CSE', 'Building AI solutions for smart cities', 'student'],
        ['Priya Sharma', 'priya@iitb.ac.in', hashedPassword, 'IIT Bombay', 'EE', 'IoT and embedded systems enthusiast', 'student'],
        ['Ravi Kumar', 'ravi@iitkgp.ac.in', hashedPassword, 'IIT Kharagpur', 'Agricultural Engg', 'Robotics for sustainable farming', 'student'],
        ['Meena Iyer', 'meena@nitt.edu', hashedPassword, 'NIT Trichy', 'Electronics', 'Hardware and IoT projects', 'student'],
        ['Admin User', 'admin@unicollab.edu', adminPassword, 'UniCollab', 'Admin', 'Platform Administrator', 'admin'],
    ];

    for (const user of users) {
        await dbRun(`INSERT INTO users (name, email, password, university, department, bio, role) VALUES (?, ?, ?, ?, ?, ?, ?)`, user);
    }

    // Fetch user IDs
    const userIds = await dbAll(`SELECT id, name FROM users WHERE role != 'admin' LIMIT 4`);
    
    const projects = [
        ['Smart Campus Navigation', 'AI-powered indoor navigation using BLE beacons and computer vision', 'AI / ML', 'Open', 'Python,OpenCV,Flutter,Firebase', 'IIT Delhi', 'CSE', 'Arjun Mehta', userIds[0]?.id, 142, 831, 1, 'https://github.com/example/smart-campus', 'https://demo.com', 4],
        ['MediTrack Patient Portal', 'Patient management system with telemedicine features', 'Healthcare', 'In Progress', 'React,Node.js,MongoDB,TensorFlow', 'AIIMS Delhi', 'Biomedical', 'Priya Sharma', userIds[1]?.id, 98, 603, 1, '', '', 3],
        ['AgriBot Field Assistant', 'Autonomous robotic system for precision agriculture', 'Robotics', 'Open', 'ROS,Python,Arduino,TensorFlow', 'IIT Kharagpur', 'Agricultural Engg', 'Ravi Kumar', userIds[2]?.id, 215, 1204, 1, 'https://github.com/example/agribot', '', 6],
        ['EcoSense Air Monitor', 'Low-cost IoT sensor network for air quality monitoring', 'IoT', 'Open', 'Arduino,Python,React,MQTT', 'NIT Trichy', 'Electronics', 'Meena Iyer', userIds[3]?.id, 87, 412, 1, 'https://github.com/example/ecosense', 'https://demo.com', 2],
        ['BlockVote: Decentralized Voting', 'Blockchain-based voting system', 'Blockchain', 'Open', 'Solidity,Ethereum,React,Node.js', 'IIT Bombay', 'CSE', 'Priya Sharma', userIds[1]?.id, 156, 923, 1, 'https://github.com/example/blockvote', '', 5],
        ['CryptoFi DeFi Dashboard', 'Unified DeFi portfolio tracker with risk analysis', 'FinTech', 'Open', 'React,Ethers.js,Python,Solidity', 'IIM Ahmedabad', 'Finance Tech', 'Rohit Mehta', userIds[0]?.id, 74, 298, 1, '', '', 2],
        ['LearnPath Adaptive EdTech', 'Personalized learning platform using knowledge graphs', 'EdTech', 'Open', 'Python,React,Neo4j,TensorFlow', 'IIT Bombay', 'CS', 'Neha Singh', userIds[1]?.id, 163, 789, 1, '', '', 3],
    ];

    for (const proj of projects) {
        await dbRun(`INSERT INTO projects (title, description, category, status, tech_stack, university, department, author, author_id, likes_count, views_count, open_collab, github_url, demo_url, team_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, proj);
    }
    console.log('✅ Sample data inserted');
};

// ==================== MIDDLEWARE ====================
const rateLimit = new Map();
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 100;
    
    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    const data = rateLimit.get(ip);
    if (now > data.resetTime) {
        rateLimit.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    if (data.count >= maxRequests) {
        return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    
    data.count++;
    next();
};

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await dbGet('SELECT id, name, email, university, department, bio, role FROM users WHERE id = ?', [decoded.userId]);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// ==================== AUTH ENDPOINTS ====================
app.post('/api/auth/register', rateLimitMiddleware, async (req, res) => {
    const { name, email, password, university, department } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    try {
        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await dbRun(
            `INSERT INTO users (name, email, password, university, department) VALUES (?, ?, ?, ?, ?)`,
            [name, email.toLowerCase(), hashedPassword, university || null, department || null]
        );
        
        const user = await dbGet('SELECT id, name, email, university, department, bio, role FROM users WHERE email = ?', [email.toLowerCase()]);
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', rateLimitMiddleware, async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    try {
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                university: user.university,
                department: user.department,
                bio: user.bio,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    res.json({ user: req.user });
});

// ==================== PROJECTS ENDPOINTS ====================
app.get('/api/projects', async (req, res) => {
    const { category, status, search, userId } = req.query;
    
    let query = `SELECT p.*, 
                        (SELECT COUNT(*) FROM project_likes WHERE project_id = p.id) as likes_count,
                        (SELECT COUNT(*) FROM collaborations WHERE project_id = p.id AND status = 'accepted') as collab_count
                 FROM projects p WHERE 1=1`;
    const params = [];
    
    if (userId) {
        query += ` AND p.author_id = ?`;
        params.push(userId);
    }
    
    if (category && category !== '') {
        query += ` AND p.category = ?`;
        params.push(category);
    }
    
    if (status && status !== '') {
        query += ` AND p.status = ?`;
        params.push(status);
    }
    
    if (search && search !== '') {
        query += ` AND (p.title LIKE ? OR p.description LIKE ? OR p.university LIKE ? OR p.author LIKE ?)`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    query += ` ORDER BY p.created_at DESC`;
    
    const projects = await dbAll(query, params);
    
    res.json({ projects });
});

app.get('/api/projects/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        await dbRun('UPDATE projects SET views_count = views_count + 1 WHERE id = ?', [id]);
        
        const project = await dbGet(`
            SELECT p.*, 
                   (SELECT COUNT(*) FROM project_likes WHERE project_id = p.id) as likes_count
            FROM projects p WHERE p.id = ?
        `, [id]);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json({ project });
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/projects', authenticateToken, async (req, res) => {
    const { title, description, category, status, tech_stack, university, department, open_collab, github_url, demo_url, team_size } = req.body;
    
    if (!title || !description || !category) {
        return res.status(400).json({ error: 'Title, description, and category are required' });
    }
    
    try {
        const result = await dbRun(
            `INSERT INTO projects (title, description, category, status, tech_stack, university, department, author, author_id, open_collab, github_url, demo_url, team_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, description, category, status || 'Open', tech_stack, university || req.user.university, department || req.user.department, req.user.name, req.user.id, open_collab !== undefined ? open_collab : 1, github_url || null, demo_url || null, team_size || 1]
        );
        
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [result.lastID]);
        
        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            project
        });
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/projects/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, open_collab } = req.body;
    
    try {
        const project = await dbGet('SELECT author_id FROM projects WHERE id = ?', [id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.author_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
        
        await dbRun(`UPDATE projects SET status = ?, open_collab = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
            [status, open_collab, id]);
        
        res.json({ success: true, message: 'Project updated' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/projects/:id/like', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
        const existing = await dbGet('SELECT id FROM project_likes WHERE project_id = ? AND user_id = ?', [id, req.user.id]);
        
        let liked;
        
        if (existing) {
            await dbRun('DELETE FROM project_likes WHERE id = ?', [existing.id]);
            await dbRun('UPDATE projects SET likes_count = likes_count - 1 WHERE id = ?', [id]);
            liked = false;
        } else {
            await dbRun('INSERT INTO project_likes (project_id, user_id) VALUES (?, ?)', [id, req.user.id]);
            await dbRun('UPDATE projects SET likes_count = likes_count + 1 WHERE id = ?', [id]);
            liked = true;
        }
        
        const project = await dbGet('SELECT likes_count FROM projects WHERE id = ?', [id]);
        res.json({ liked, likes_count: project.likes_count });
    } catch (error) {
        console.error('Like/Unlike error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/projects/:id/like-status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const existing = await dbGet('SELECT id FROM project_likes WHERE project_id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ liked: !!existing });
});

app.post('/api/projects/:id/collaborate', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    
    try {
        const project = await dbGet('SELECT author_id, title, open_collab FROM projects WHERE id = ?', [id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (!project.open_collab) return res.status(400).json({ error: 'This project is not open for collaboration' });
        if (project.author_id === req.user.id) return res.status(400).json({ error: 'You cannot collaborate on your own project' });
        
        const existing = await dbGet('SELECT status FROM collaborations WHERE project_id = ? AND requester_id = ?', [id, req.user.id]);
        if (existing) return res.status(409).json({ error: 'Collaboration request already exists' });
        
        await dbRun('INSERT INTO collaborations (project_id, requester_id, message) VALUES (?, ?, ?)', [id, req.user.id, message || null]);
        
        res.status(201).json({ success: true, message: 'Collaboration request sent' });
    } catch (error) {
        console.error('Collaboration request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== PROFILE ENDPOINTS ====================
app.get('/api/profile/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const user = await dbGet('SELECT id, name, email, university, department, bio, role, created_at FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const projects = await dbAll('SELECT * FROM projects WHERE author_id = ? ORDER BY created_at DESC', [userId]);
        
        const stats = {
            totalProjects: projects.length,
            totalLikes: projects.reduce((sum, p) => sum + (p.likes_count || 0), 0),
            totalViews: projects.reduce((sum, p) => sum + (p.views_count || 0), 0)
        };
        
        res.json({ user, projects, stats });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    const { name, university, department, bio } = req.body;
    
    try {
        await dbRun(`UPDATE users SET name = ?, university = ?, department = ?, bio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [name, university, department, bio, req.user.id]);
        
        const updatedUser = await dbGet('SELECT id, name, email, university, department, bio, role FROM users WHERE id = ?', [req.user.id]);
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== STATS ENDPOINTS ====================
app.get('/api/stats', async (req, res) => {
    try {
        const projectsCount = await dbGet('SELECT COUNT(*) as count FROM projects');
        const universitiesCount = await dbGet('SELECT COUNT(DISTINCT university) as count FROM users WHERE university IS NOT NULL AND university != ""');
        const collaboratorsCount = await dbGet('SELECT COUNT(*) as count FROM users WHERE role != "admin"');
        const totalLikes = await dbGet('SELECT SUM(likes_count) as total FROM projects');
        
        res.json({
            projects: projectsCount?.count || 0,
            universities: universitiesCount?.count || 0,
            collaborators: collaboratorsCount?.count || 0,
            likes: totalLikes?.total || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== SERVE FRONTEND ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== START SERVER ====================
const startServer = async () => {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log(`🚀 UniCollab Server running on http://localhost:${PORT}`);
            console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
            console.log(`✅ Using SQLite database - no PostgreSQL needed!`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();