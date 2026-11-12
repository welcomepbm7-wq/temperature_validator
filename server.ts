import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Persistent Database Directory & File
const DATA_DIR = path.resolve(__dirname, 'instance');
const DATA_FILE = path.resolve(DATA_DIR, 'data.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface User {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  created_at: string;
}

interface Session {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

interface Reading {
  id: number;
  user_id: number;
  reading_number: number;
  temperature: number;
  unit: string;
  scale: 'Celsius' | 'Fahrenheit' | 'Kelvin';
  kelvin: number;
  validation_status: string;
  is_valid: boolean;
  interval_seconds: number;
  timestamp: string;
}

interface DatabaseSchema {
  users: User[];
  sessions: Session[];
  history: Reading[];
}

function loadDatabase(): DatabaseSchema {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading database file:', err);
  }
  const initial: DatabaseSchema = { users: [], sessions: [], history: [] };
  saveDatabase(initial);
  return initial;
}

function saveDatabase(db: DatabaseSchema) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database file:', err);
  }
}

// Strict Username Validation
function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = (username || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Username must not be empty.' };
  }
  // English uppercase and lowercase letters only
  if (!/^[A-Za-z]+$/.test(trimmed)) {
    if (/[0-9]/.test(trimmed)) {
      return { valid: false, error: 'Username cannot contain numbers. Only English letters (A-Z, a-z) are allowed.' };
    }
    if (/\s/.test(trimmed)) {
      return { valid: false, error: 'Username cannot contain spaces.' };
    }
    return { valid: false, error: 'Username cannot contain special characters or symbols. Only letters (A-Z, a-z) are allowed.' };
  }
  if (!/[A-Z]/.test(trimmed)) {
    return { valid: false, error: 'Username must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(trimmed)) {
    return { valid: false, error: 'Username must contain at least one lowercase letter (a-z).' };
  }
  return { valid: true };
}

// Strict Password Validation
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: false, error: 'Password cannot be empty.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number (0-9).' };
  }
  if (!/[@#$%!&*_+\-=~^()[\]{}|;:,.<>?/]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character (@, #, $, %, !, &).' };
  }
  return { valid: true };
}

// Password Hashing with PBKDF2-HMAC-SHA256
function hashPassword(password: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(32);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return { hash, salt: salt.toString('hex') };
}

function verifyPassword(password: string, hash: string, saltHex: string): boolean {
  const computed = hashPassword(password, saltHex).hash;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

// Seed default demo account if not existing
const db = loadDatabase();
if (!db.users.some((u) => u.username.toLowerCase() === 'priyotosh')) {
  const { hash, salt } = hashPassword('Priyo@123');
  db.users.push({
    id: 1,
    username: 'Priyotosh',
    password_hash: hash,
    salt,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });
  saveDatabase(db);
  console.log('[Database] Seeded initial account: Priyotosh / Priyo@123');
}

// Active Simulation Manager
interface ActiveSim {
  timer: NodeJS.Timeout;
  scale: 'Celsius' | 'Fahrenheit' | 'Kelvin';
  interval: number;
  latestReading: Reading;
  readingNumber: number;
}
const activeSimulations = new Map<number, ActiveSim>();
const userDashboardCleared = new Set<number>();

// Temperature calculation logic matching user's Python code
function randomUniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function generateReading(
  userId: number,
  readingNumber: number,
  scale: 'Celsius' | 'Fahrenheit' | 'Kelvin',
  interval: number
): Reading {
  let temperature = 0;
  let kelvin = 0;
  let unit = '';

  if (scale === 'Celsius') {
    // Celsius: -300 to -246.30
    temperature = round2(randomUniform(-300, -246.30));
    kelvin = temperature + 273.15;
    unit = '°C';
  } else if (scale === 'Fahrenheit') {
    // Fahrenheit: -500 to -419.34
    temperature = round2(randomUniform(-500, -419.34));
    kelvin = (temperature - 32) * (5 / 9) + 273.15;
    unit = '°F';
  } else {
    // Kelvin: -50 to 50
    temperature = round2(randomUniform(-50, 50));
    kelvin = temperature;
    unit = 'K';
  }

  kelvin = round2(kelvin);
  const is_valid = kelvin >= 0;
  const validation_status = is_valid ? 'Valid Temperature' : 'Invalid Temperature';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    user_id: userId,
    reading_number: readingNumber,
    temperature,
    unit,
    scale,
    kelvin,
    validation_status,
    is_valid,
    interval_seconds: interval,
    timestamp,
  };
}

// Auth Helper
function getAuthUser(req: express.Request): User | null {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const parts = req.headers.cookie.split(';');
    for (const part of parts) {
      const [k, v] = part.trim().split('=');
      if (k === 'session_token') {
        token = v;
        break;
      }
    }
  }

  if (!token) return null;

  const currentDb = loadDatabase();
  const now = new Date().toISOString();
  const session = currentDb.sessions.find((s) => s.token === token && s.expires_at > now);
  if (!session) return null;

  const user = currentDb.users.find((u) => u.id === session.user_id);
  return user || null;
}

// ================= API ROUTES =================

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'IoT Temperature Validation System' });
});

// View exact Python source code from temperature_validator.py
app.get('/api/python-code', (_req, res) => {
  const pyPath = path.resolve(__dirname, 'temperature_validator.py');
  if (fs.existsSync(pyPath)) {
    const code = fs.readFileSync(pyPath, 'utf-8');
    res.json({ code, filename: 'temperature_validator.py' });
  } else {
    res.status(404).json({ error: 'Python file not found' });
  }
});

// Signup
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body;
  const userValidation = validateUsername(username);
  if (!userValidation.valid) {
    res.status(400).json({ error: userValidation.error });
    return;
  }

  const pwdValidation = validatePassword(password);
  if (!pwdValidation.valid) {
    res.status(400).json({ error: pwdValidation.error });
    return;
  }

  const currentDb = loadDatabase();
  const cleanUsername = username.trim();
  if (currentDb.users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    res.status(400).json({ error: `Username '${cleanUsername}' is already taken. Please choose another.` });
    return;
  }

  const { hash, salt } = hashPassword(password);
  const newUser: User = {
    id: currentDb.users.length > 0 ? Math.max(...currentDb.users.map((u) => u.id)) + 1 : 1,
    username: cleanUsername,
    password_hash: hash,
    salt,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  currentDb.users.push(newUser);

  // Create session
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  currentDb.sessions.push({
    token,
    user_id: newUser.id,
    created_at: new Date().toISOString(),
    expires_at: expires,
  });

  saveDatabase(currentDb);

  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.status(201).json({
    message: 'Account created successfully.',
    user: { id: newUser.id, username: newUser.username, created_at: newUser.created_at },
    token,
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const cleanUsername = (username || '').trim();

  const currentDb = loadDatabase();
  const user = currentDb.users.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());

  if (!user || !verifyPassword(password || '', user.password_hash, user.salt)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  currentDb.sessions.push({
    token,
    user_id: user.id,
    created_at: new Date().toISOString(),
    expires_at: expires,
  });

  saveDatabase(currentDb);

  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({
    message: 'Login successful.',
    user: { id: user.id, username: user.username, created_at: user.created_at },
    token,
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  const user = getAuthUser(req);
  if (user) {
    const sim = activeSimulations.get(user.id);
    if (sim) {
      clearInterval(sim.timer);
      activeSimulations.delete(user.id);
    }
  }

  res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.json({ message: 'Logged out successfully.' });
});

// Get Current User
app.get('/api/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }
  res.json({ user: { id: user.id, username: user.username, created_at: user.created_at } });
});

// Start Simulation
app.post('/api/simulation/start', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  const { scale, interval: rawInterval } = req.body;

  if (!['Celsius', 'Fahrenheit', 'Kelvin'].includes(scale)) {
    res.status(400).json({ error: 'Invalid temperature scale. Choose Celsius, Fahrenheit, or Kelvin.' });
    return;
  }

  if (rawInterval === undefined || rawInterval === null || String(rawInterval).trim() === '') {
    res.status(400).json({ error: 'Time interval cannot be empty.' });
    return;
  }

  const interval = parseFloat(rawInterval);
  if (isNaN(interval) || !isFinite(interval) || interval <= 0) {
    res.status(400).json({ error: 'Time interval must be a positive number greater than 0.' });
    return;
  }

  // Prevent multiple simulation loops for the same student
  if (activeSimulations.has(user.id)) {
    const existing = activeSimulations.get(user.id)!;
    res.json({
      message: 'Simulation is already running.',
      is_running: true,
      latest_reading: existing.latestReading,
      reading_number: existing.readingNumber,
    });
    return;
  }

  const currentDb = loadDatabase();
  const userHistory = currentDb.history.filter((h) => h.user_id === user.id);
  const nextReadingNumber = userHistory.length > 0 ? Math.max(...userHistory.map((h) => h.reading_number)) + 1 : 1;

  // Generate first reading immediately
  const firstReading = generateReading(user.id, nextReadingNumber, scale, interval);
  currentDb.history.push(firstReading);
  saveDatabase(currentDb);

  // Background interval timer
  let currentNum = nextReadingNumber;
  let latest = firstReading;

  const timer = setInterval(() => {
    currentNum += 1;
    const reading = generateReading(user.id, currentNum, scale, interval);
    const dbUpdate = loadDatabase();
    dbUpdate.history.push(reading);
    saveDatabase(dbUpdate);

    latest = reading;
    const currentSim = activeSimulations.get(user.id);
    if (currentSim) {
      currentSim.latestReading = reading;
      currentSim.readingNumber = currentNum;
    }
  }, Math.max(100, interval * 1000));

  activeSimulations.set(user.id, {
    timer,
    scale,
    interval,
    latestReading: firstReading,
    readingNumber: nextReadingNumber,
  });

  const userHistoryAfterStart = currentDb.history
    .filter((h) => h.user_id === user.id)
    .sort((a, b) => b.id - a.id);

  res.json({
    message: 'Simulation started successfully.',
    is_running: true,
    latest_reading: firstReading,
    reading_number: nextReadingNumber,
    scale,
    interval,
    recent_history: userHistoryAfterStart.slice(0, 100),
    total_readings: userHistoryAfterStart.length,
  });
});

// Stop Simulation
app.post('/api/simulation/stop', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  const currentDb = loadDatabase();
  const userHistory = currentDb.history
    .filter((h) => h.user_id === user.id)
    .sort((a, b) => b.id - a.id);

  const sim = activeSimulations.get(user.id);
  if (!sim) {
    const latest = userHistory.length > 0 ? userHistory[0] : null;
    res.json({
      message: 'Simulation is already stopped.',
      is_running: false,
      latest_reading: latest,
      reading_number: latest ? latest.reading_number : 0,
      recent_history: userHistory.slice(0, 100),
      total_readings: userHistory.length,
    });
    return;
  }

  clearInterval(sim.timer);
  const latest = sim.latestReading;
  const readingNumber = sim.readingNumber;
  activeSimulations.delete(user.id);

  res.json({
    message: 'Simulation stopped. All readings preserved.',
    is_running: false,
    latest_reading: latest,
    reading_number: readingNumber,
    recent_history: userHistory.slice(0, 100),
    total_readings: userHistory.length,
  });
});

// Simulation Status
app.get('/api/simulation/status', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  const currentDb = loadDatabase();
  const userHistory = currentDb.history
    .filter((h) => h.user_id === user.id)
    .sort((a, b) => b.id - a.id);

  const sim = activeSimulations.get(user.id);
  if (sim) {
    res.json({
      is_running: true,
      scale: sim.scale,
      interval: sim.interval,
      latest_reading: sim.latestReading,
      reading_number: sim.readingNumber,
      recent_history: userHistory.slice(0, 100),
      total_readings: userHistory.length,
    });
    return;
  }

  const isCleared = userDashboardCleared.has(user.id);
  const latest = !isCleared && userHistory.length > 0 ? userHistory[0] : null;

  res.json({
    is_running: false,
    latest_reading: latest,
    reading_number: latest ? latest.reading_number : 0,
    recent_history: userHistory.slice(0, 100),
    total_readings: userHistory.length,
  });
});

// Strict User-Isolated History (Newest first)
app.get('/api/history', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  const currentDb = loadDatabase();
  // Filter STRICTLY for this user only
  const userHistory = currentDb.history
    .filter((h) => h.user_id === user.id)
    .sort((a, b) => b.id - a.id);

  res.json({
    history: userHistory,
    total: userHistory.length,
    username: user.username,
  });
});

// Clear All History for Authenticated Student (Clears BOTH history and dashboard)
app.delete('/api/history', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  // Stop active simulation if running
  const sim = activeSimulations.get(user.id);
  if (sim) {
    clearInterval(sim.timer);
    activeSimulations.delete(user.id);
  }

  // Clear history from database
  const currentDb = loadDatabase();
  currentDb.history = currentDb.history.filter((h) => h.user_id !== user.id);
  saveDatabase(currentDb);

  // Clear dashboard data as well
  userDashboardCleared.add(user.id);

  res.json({
    message: 'All temperature history and dashboard data have been cleared successfully.',
    total: 0,
  });
});

// Remove All Dashboard Data (Clears ONLY Dashboard display, leaves History page data intact)
app.post('/api/dashboard/reset', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  // Stop active simulation if running
  const sim = activeSimulations.get(user.id);
  if (sim) {
    clearInterval(sim.timer);
    activeSimulations.delete(user.id);
  }

  // Mark dashboard as cleared - DO NOT touch history in database!
  userDashboardCleared.add(user.id);

  res.json({
    message: 'Dashboard data cleared. History page records remain safely preserved.',
    is_running: false,
    latest_reading: null,
    reading_number: 0,
  });
});

// Student Daily Routine & Privacy Analytics (Strictly isolated to authenticated student)
app.get('/api/student/daily-routine', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const currentDb = loadDatabase();

  // STRICT ISOLATION: Only records belonging to this specific student ID!
  const userHistory = currentDb.history.filter((h) => h.user_id === user.id);
  const todaysHistory = userHistory.filter((h) => (h.timestamp || '').startsWith(todayStr));

  const totalToday = todaysHistory.length;
  const validToday = todaysHistory.filter((h) => h.is_valid).length;
  const invalidToday = todaysHistory.filter((h) => !h.is_valid).length;
  const validRatio = totalToday > 0 ? Math.round((validToday / totalToday) * 100) : 100;
  const latestTimestamp = todaysHistory.length > 0 ? todaysHistory[todaysHistory.length - 1].timestamp : null;

  res.json({
    date: todayStr,
    username: user.username,
    student_id: user.id,
    total_today: totalToday,
    valid_today: validToday,
    invalid_today: invalidToday,
    valid_ratio: validRatio,
    latest_timestamp: latestTimestamp,
    privacy_status: 'Strict Isolation Active: Protected student sandbox (zero cross-student visibility)',
  });
});

// Frontend Integration
async function createServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Temperature Validation and Monitoring System listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('[Server Start Failure]:', err);
});
