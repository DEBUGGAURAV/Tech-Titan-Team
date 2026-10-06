import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
const __serverDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__serverDir, '.env') })
dotenv.config()
import express from 'express'
import cors from 'cors';
import compression from 'compression';
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import Mailjet from 'node-mailjet'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as XLSX from 'xlsx'

const app = express()
app.use(compression())
const port = process.env.PORT || 5000
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' || process.env.RENDER ? '' : 'development-secret')
if (!jwtSecret) throw new Error('JWT_SECRET must be configured in production.')
app.set('trust proxy', process.env.RENDER ? 1 : false)
const otpStore = new Map()
const resetStore = new Map()
const mailjet = process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY
  ? Mailjet.apiConnect(process.env.MAILJET_API_KEY, process.env.MAILJET_SECRET_KEY)
  : null
let rawFirebaseApp = null
let rawDb = null

const initFirebase = () => {
  if (rawDb && rawFirebaseApp) return true
  if (getApps().length) {
    rawFirebaseApp = getApps()[0]
    try {
      rawDb = getFirestore(rawFirebaseApp)
      return true
    } catch (e) {
      console.warn('[Firebase] Firestore retrieval warning:', e.message)
    }
  }

  // 1. Try full JSON service account if provided (raw JSON or base64)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  if (serviceAccountJson) {
    try {
      const trimmed = serviceAccountJson.trim()
      const jsonStr = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf-8')
      const parsed = JSON.parse(jsonStr)
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        rawFirebaseApp = initializeApp({
          credential: cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          }),
        })
        rawDb = getFirestore(rawFirebaseApp)
        console.log(`[Firebase] Initialized via service account JSON for project: ${parsed.project_id}`)
        return true
      }
    } catch (err) {
      console.warn('[Firebase] JSON service account parse warning:', err.message)
    }
  }

  // 2. Try individual environment variables (project ID is 100% automatic and never demanded)
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || process.env.CLIENT_EMAIL || '').trim().replace(/^["']|["']$/g, '')
  let privateKey = (process.env.FIREBASE_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '')
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n')
  }

  // Automatically derive project ID from service account email (e.g. @tech-titan-team.iam.gserviceaccount.com) or default
  const extractedFromEmail = clientEmail.match(/@([^.]+)\.iam\.gserviceaccount\.com/i)?.[1] || ''
  const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.PROJECT_ID || extractedFromEmail || 'tech-titan-team').trim().replace(/^["']|["']$/g, '')

  if (clientEmail && privateKey) {
    try {
      rawFirebaseApp = initializeApp({
        credential: cert({
          projectId: projectId || 'tech-titan-team',
          clientEmail,
          privateKey,
        }),
      })
      rawDb = getFirestore(rawFirebaseApp)
      console.log(`[Firebase] Initialized with credentials for project: ${projectId || 'tech-titan-team'}`)
      return true
    } catch (err) {
      console.error('[Firebase] Failed to initialize with provided credentials:', err.message)
    }
  }

  // 3. Try initializeApp with default project ID or Application Default Credentials
  try {
    rawFirebaseApp = initializeApp({ projectId: projectId || 'tech-titan-team' })
    rawDb = getFirestore(rawFirebaseApp)
    console.log(`[Firebase] Initialized with application defaults for project: ${projectId || 'tech-titan-team'}`)
    return true
  } catch (err) {
    console.warn('[Firebase] Application Default Credentials init notice:', err.message)
  }

  console.error('========================================================================')
  console.error('⚠️ [CONFIGURATION NOTICE]: Firebase credentials pending in environment!')
  console.error('In your Render dashboard (techtitan-api -> Environment), add:')
  console.error('  FIREBASE_CLIENT_EMAIL = (your service account email)')
  console.error('  FIREBASE_PRIVATE_KEY  = (your private key starting with -----BEGIN PRIVATE KEY-----)')
  console.error('========================================================================')
  return false
}

initFirebase()

const isFirebaseReady = () => Boolean(rawDb)

// Proxy around Firestore to prevent app crash if credentials are unset during initial deployment
const db = new Proxy({}, {
  get(_target, prop) {
    if (!rawDb) initFirebase()
    if (rawDb && typeof rawDb[prop] !== 'undefined') {
      return typeof rawDb[prop] === 'function' ? rawDb[prop].bind(rawDb) : rawDb[prop]
    }
    if (prop === 'collection') {
      return (collName) => {
        if (!rawDb) initFirebase()
        if (rawDb) return rawDb.collection(collName)
        throw new Error('Database is not initialized. Please configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Render environment.')
      }
    }
    return () => {
      throw new Error('Database is not initialized. Please configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Render environment.')
    }
  }
})
const adminEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
const noticeBoardCollection = () => db.collection('noticeBoard')
const noticeExpiryMs = 5 * 24 * 60 * 60 * 1000 // 5 days automatic expiration

// --- IN-MEMORY CACHE & QUOTA PROTECTION LAYER ---
const serverCache = new Map()

const getFromCache = (key, maxAgeMs = 60000) => {
  const item = serverCache.get(key)
  if (!item) return null
  if (Date.now() - item.timestamp > maxAgeMs) {
    return null // Expired for normal serving, but remains available for fallback
  }
  return item.data
}

const getStaleFallback = (key) => {
  const item = serverCache.get(key)
  return item ? item.data : null
}

const saveToCache = (key, data) => {
  serverCache.set(key, { data, timestamp: Date.now() })
}

const invalidateCache = (...keys) => {
  for (const k of keys) {
    serverCache.delete(k)
  }
}

const isQuotaError = (err) => {
  if (!err) return false
  return err.code === 8 ||
         err.code === 'RESOURCE_EXHAUSTED' ||
         String(err.details || '').includes('Quota exceeded') ||
         String(err.message || '').includes('Quota exceeded')
}

const studentYears = ['1st year', '2nd year', '3rd year', '4th year']
const normalizeMobile = (value) => typeof value === 'string' ? value.trim() : ''
const isProtectedAdminEmail = (email) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const primaryAdmin = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  return Boolean(normalizedEmail) && (normalizedEmail === primaryAdmin || adminEmails.has(normalizedEmail))
}
const isValidMobile = (value) => {
  const mobile = normalizeMobile(value)
  const digitCount = (mobile.match(/\d/g) || []).length
  return mobile.length <= 20 && /^\+?[0-9][0-9\s().-]*$/.test(mobile) && digitCount >= 7 && digitCount <= 15
}
const toIso = (value) => value?.toDate?.().toISOString() || (typeof value === 'string' ? value : '')
const userActivityCollection = (userId) => db.collection('users').doc(userId).collection('activity')
const adminActionsCollection = () => db.collection('adminActions')
const adminRoleRequestsCollection = () => db.collection('adminRoleRequests')
const deletedAccountsCollection = () => db.collection('deletedAccounts')
const isPrimaryAdmin = (user) => Boolean((process.env.ADMIN_EMAIL || '').trim()) && user?.email?.trim().toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase()
const serializeAdminRoleRequest = (snapshot) => {
  const request = snapshot.data()
  return {
    id: snapshot.id,
    requesterName: request.requesterName || '',
    requesterEmail: request.requesterEmail || '',
    targetUserId: request.targetUserId || '',
    targetName: request.targetName || '',
    targetEmail: request.targetEmail || '',
    status: request.status || 'pending',
    requestedAt: toIso(request.requestedAt),
    decidedByName: request.decidedByName || '',
    decidedByEmail: request.decidedByEmail || '',
    decisionNote: request.decisionNote || '',
    decidedAt: toIso(request.decidedAt),
  }
}
const describeNotePermissions = (user) => {
  if (user.role === 'admin') return 'Full admin'
  if (user.role === 'content_admin') return 'Upload, edit, delete, review'
  const labels = { uploadNotes: 'Upload', editNotes: 'Edit', deleteNotes: 'Delete', reviewNotes: 'Review' }
  return notePermissionNames.filter((permission) => user.permissions?.[permission] === true).map((permission) => labels[permission]).join(', ')
}
const createNoticeRecord = async ({ title, message, type = 'general' }) => {
  const safeTitle = String(title || '').trim()
  const safeMessage = String(message || '').trim()
  if (!safeTitle || !safeMessage) return null
  const payload = {
    title: safeTitle.slice(0, 120),
    message: safeMessage.slice(0, 1000),
    type: ['general', 'note', 'update'].includes(type) ? type : 'general',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + noticeExpiryMs,
  }
  const created = await noticeBoardCollection().add(payload)
  invalidateCache('notices:active')
  return { id: created.id, ...payload, expiresAt: payload.expiresAt, createdAt: new Date().toISOString() }
}
const pruneExpiredNotices = async () => {
  try {
    const now = Date.now()
    const expiredSnapshot = await noticeBoardCollection().where('expiresAt', '<=', now).limit(25).get()
    if (expiredSnapshot.empty) return 0
    const batch = db.batch()
    expiredSnapshot.docs.forEach((snapshot) => {
      batch.delete(snapshot.ref)
    })
    await batch.commit()
    invalidateCache('notices:active')
    return expiredSnapshot.size
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] Notice pruning deferred due to quota limit.')
      return 0
    }
    console.warn('[Notice Prune Warning]:', err.message)
    return 0
  }
}
const canManageNoticeBoard = (user) => Boolean(user) && (user.role === 'admin' || user.role === 'content_admin' || hasAnyNotePermission(user))
const createActivityRecord = (event, req, details = {}) => ({
  event,
  ipAddress: req.ip || '',
  eventAt: FieldValue.serverTimestamp(),
  ...details,
})
const recordUserActivity = (userId, req, event, details) => userActivityCollection(userId).add(createActivityRecord(event, req, details))
const createAdminAction = (req, target, action, status = 'completed') => ({
  action,
  status,
  actorId: req.user.id,
  actorName: req.user.name || '',
  actorEmail: req.user.email || '',
  actorMobile: req.user.mobile || '',
  targetUserId: target.id,
  targetName: target.name || '',
  targetEmail: target.email || '',
  targetMobile: target.mobile || '',
  ipAddress: req.ip || '',
  occurredAt: FieldValue.serverTimestamp(),
})
const serializeUser = (snapshot) => {
  const { passwordHash, createdAt, ...user } = snapshot.data()
  return { id: snapshot.id, ...user, registeredAt: toIso(createdAt) }
}

// --- THREAT MITIGATION: SECURITY HEADERS (OWASP / ZERO-TRUST) ---
app.disable('x-powered-by')

app.use((req, res, next) => {
  // Prevent Clickjacking attacks
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  // Prevent MIME sniffing exploits
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Enable legacy XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // Prevent referrer leakage of sensitive routes/tokens
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Restrict sensitive browser APIs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Enforce HTTPS over reverse proxies
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }
  next()
})

// --- THREAT MITIGATION: PROTOTYPE POLLUTION & PARAMETER TAMPERING DEFENSE ---
app.use((req, _res, next) => {
  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key]
      } else if (typeof obj[key] === 'object') {
        sanitize(obj[key])
      }
    }
  }
  if (req.body) sanitize(req.body)
  if (req.query) sanitize(req.query)
  if (req.params) sanitize(req.params)
  next()
})

// --- THREAT MITIGATION: IN-MEMORY RATE LIMITING (BRUTE FORCE & DOS MITIGATION) ---
const rateLimitStore = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) rateLimitStore.delete(key)
  }
}, 5 * 60 * 1000)

const createRateLimiter = ({ windowMs = 60 * 1000, max = 150, message = 'Too many requests. Please slow down.' }) => {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
    const key = `${req.baseUrl || req.path}:${ip}`
    const now = Date.now()
    let record = rateLimitStore.get(key)
    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs }
      rateLimitStore.set(key, record)
      return next()
    }
    record.count += 1
    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000)
      res.setHeader('Retry-After', retryAfter)
      return res.status(429).json({ message, retryAfter })
    }
    next()
  }
}

const generalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many requests to the server. Please slow down.'
})

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many sign-in attempts. Please wait 15 minutes before trying again.'
})

const otpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: 'Too many verification code requests. Please wait 10 minutes before requesting another code.'
})

// --- ROBUST, MULTI-ORIGIN & THREAT-PROTECTED CORS CONFIGURATION ---
const configuredClientOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

const explicitlyAllowedOrigins = new Set([
  ...configuredClientOrigins,
  'https://notessharinggroup.onrender.com',
  'https://notessharingroup.onrender.com',
  'https://techtitan-api.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
])

const isAllowedOrigin = (origin) => {
  // Allow requests without Origin header (mobile apps, server-to-server, curl, Postman, same-origin)
  if (!origin) return true
  const cleanOrigin = origin.trim().replace(/\/+$/, '')
  if (explicitlyAllowedOrigins.has(cleanOrigin)) return true

  // Localhost / 127.0.0.1 on ANY port
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)) return true

  // Local Area Network (LAN) testing on phones/tablets via Wi-Fi (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  if (/^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i.test(cleanOrigin)) return true

  // Any Render deployment subdomain (*.onrender.com)
  if (/^https:\/\/[a-zA-Z0-9-]+\.onrender\.com$/i.test(cleanOrigin)) return true

  // Vercel / Netlify preview & production domains
  if (/^https:\/\/[a-zA-Z0-9-]+\.(vercel\.app|netlify\.app|pages\.dev)$/i.test(cleanOrigin)) return true

  return false
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true)
    }
    // CRITICAL FIX: Return callback(null, false) instead of throwing new Error('Origin is not allowed by CORS.').
    // Throwing an Error crashes Express with a 500 status code.
    // Returning false safely tells the browser that CORS is not granted without crashing the server.
    return callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400, // Cache preflight OPTIONS responses for 24 hours
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Threat Mitigation: Request body size limit to prevent Denial of Service (DoS) memory exhaustion
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Apply general rate limiting across /api endpoints
app.use('/api', generalLimiter)

app.get('/api/health', (_req, res) => {
  const ready = isFirebaseReady()
  const missing = []
  if (!process.env.FIREBASE_CLIENT_EMAIL) missing.push('FIREBASE_CLIENT_EMAIL')
  if (!process.env.FIREBASE_PRIVATE_KEY) missing.push('FIREBASE_PRIVATE_KEY')
  res.json({
    ok: true,
    service: 'tech-titan-team',
    status: 'online',
    database: ready ? 'connected' : 'pending_configuration',
    ...(missing.length > 0 ? { notice: 'Configure variables in Render Dashboard -> Environment', missing } : {}),
  })
})

const authRequired = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const identity = jwt.verify(token, jwtSecret)
    const snapshot = await db.collection('users').doc(identity.userId).get()
    if (!snapshot.exists || snapshot.data().blocked) return res.status(403).json({ message: 'This account is blocked.' })
    req.user = { id: snapshot.id, ...snapshot.data() }
    next()
  } catch {
    res.status(401).json({ message: 'Sign in required.' })
  }
}

const adminRequired = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ message: 'Admin access required.' })
const notePermissionNames = ['uploadNotes', 'editNotes', 'deleteNotes', 'reviewNotes']
const hasNotePermission = (user, permission) => user?.role === 'admin' || user?.role === 'content_admin' || user?.permissions?.[permission] === true
const hasAnyNotePermission = (user) => notePermissionNames.some((permission) => hasNotePermission(user, permission))
const serialize = (snapshot) => {
  const data = snapshot.data()
  return { id: snapshot.id, ...data, ...(data.createdAt ? { createdAt: toIso(data.createdAt) || data.createdAt } : {}) }
}
const serializePublicNote = (snapshot) => {
  const { authorId, ...note } = serialize(snapshot)
  return { ...note, author: note.author ? 'Student contributor' : '' }
}

app.get('/api/notes', authRequired, async (_req, res) => {
  try {
    const cached = getFromCache('notes:public', 60000)
    if (cached) return res.json(cached)

    const snapshot = await db.collection('notes').where('status', '==', 'approved').get()
    const notes = snapshot.docs.map(serializePublicNote).sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    saveToCache('notes:public', notes)
    res.json(notes)
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] /api/notes hit quota limit. Serving cached/fallback notes.')
      const fallback = getStaleFallback('notes:public') || []
      return res.json(fallback)
    }
    console.error('[Notes Fetch Error]:', err.message)
    res.status(500).json({ message: 'Unable to load notes right now.' })
  }
})
app.post('/api/notes/:id/access', authRequired, async (req, res) => {
  try {
    const noteSnapshot = await db.collection('notes').doc(req.params.id).get()
    if (!noteSnapshot.exists || noteSnapshot.data().status !== 'approved') return res.status(404).json({ message: 'Note not found.' })
    const note = noteSnapshot.data()
    await recordUserActivity(req.user.id, req, 'note_download', { noteId: noteSnapshot.id, noteTitle: note.title || '', subject: note.subject || '' }).catch(() => {})
    res.json({ recorded: true })
  } catch (err) {
    if (isQuotaError(err)) {
      return res.json({ recorded: true })
    }
    res.status(500).json({ message: 'Failed to record note access.' })
  }
})
app.post('/api/notes', authRequired, async (req, res) => {
  const { title, subject, year, folderId, driveLink, status } = req.body
  if (!title || !subject || !year || !driveLink) return res.status(400).json({ message: 'Title, year, subject, and Drive link are required.' })
  const canPublish = hasNotePermission(req.user, 'uploadNotes')
  if (canPublish) {
    if (!folderId) return res.status(400).json({ message: 'Choose a subject folder for this note.' })
    const folderSnapshot = await db.collection('folders').doc(folderId).get()
    const folder = folderSnapshot.data()
    if (!folderSnapshot.exists || folder.year !== year || folder.subject !== subject) return res.status(400).json({ message: 'The selected folder does not match this note year and subject.' })
  }
  const note = { title, subject, year, folderId: folderId || '', driveLink, author: req.user.name || req.user.email, authorId: req.user.id, status: canPublish && status === 'approved' ? 'approved' : 'pending', createdAt: FieldValue.serverTimestamp() }
  const created = await db.collection('notes').add(note)
  invalidateCache('notes:public')
  if (note.status === 'approved') {
    await createNoticeRecord({
      title: 'New note added',
      message: `${note.title} was published in ${note.subject} (${note.year}).`,
      type: 'note',
    })
  }
  res.status(201).json({ id: created.id, ...note, createdAt: new Date().toISOString() })
})
app.patch('/api/notes/:id', authRequired, async (req, res) => {
  const changes = req.body && typeof req.body === 'object' ? { ...req.body } : {}
  const fields = Object.keys(changes)
  const contentFields = fields.filter((field) => field !== 'status')
  if (contentFields.length && !hasNotePermission(req.user, 'editNotes')) return res.status(403).json({ message: 'Note edit access required.' })
  if ('status' in changes && !['approved', 'rejected'].includes(changes.status)) return res.status(400).json({ message: 'Choose approved or rejected note status.' })
  if ('status' in changes && !hasNotePermission(req.user, 'reviewNotes')) return res.status(403).json({ message: 'Note review access required.' })
  if (req.user.role !== 'admin' && contentFields.some((field) => !['title', 'driveLink'].includes(field))) {
    return res.status(400).json({ message: 'This role can edit only a note title and Drive link.' })
  }
  if ('title' in changes && (typeof changes.title !== 'string' || !changes.title.trim())) return res.status(400).json({ message: 'Enter a note title.' })
  if ('driveLink' in changes && (typeof changes.driveLink !== 'string' || !changes.driveLink.trim())) return res.status(400).json({ message: 'Enter a valid Drive link.' })
  if (contentFields.some((field) => !['title', 'driveLink', 'folderId', 'subject', 'year'].includes(field))) {
    return res.status(400).json({ message: 'Unsupported note fields were provided.' })
  }
  if ('folderId' in changes || 'subject' in changes || 'year' in changes) {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only full admins can move notes between folders.' })
    if (typeof changes.folderId !== 'string' || !changes.folderId) return res.status(400).json({ message: 'Choose a subject folder for this note.' })
    const folderSnapshot = await db.collection('folders').doc(changes.folderId).get()
    if (!folderSnapshot.exists) return res.status(400).json({ message: 'The selected folder no longer exists.' })
    changes.folderId = folderSnapshot.id
    changes.subject = folderSnapshot.data().subject
    changes.year = folderSnapshot.data().year
  }
  const existingNote = await db.collection('notes').doc(req.params.id).get()
  await db.collection('notes').doc(req.params.id).update(changes)
  invalidateCache('notes:public')
  if (changes.status === 'approved' && existingNote.exists) {
    await createNoticeRecord({
      title: 'New note updated',
      message: `${existingNote.data().title || 'A note'} was approved and is now live in ${existingNote.data().subject || 'the library'} (${existingNote.data().year || 'general'}).`,
      type: 'note',
    })
  } else if (Object.keys(changes).some((key) => ['title', 'driveLink', 'subject', 'year', 'folderId'].includes(key)) && existingNote.exists) {
    await createNoticeRecord({
      title: 'Note updated',
      message: `${existingNote.data().title || 'A note'} was updated in the library.`,
      type: 'update',
    })
  }
  res.json({ id: req.params.id, ...changes })
})
app.delete('/api/notes/:id', authRequired, async (req, res) => {
  if (!hasNotePermission(req.user, 'deleteNotes')) return res.status(403).json({ message: 'Note deletion access required.' })
  await db.collection('notes').doc(req.params.id).delete()
  invalidateCache('notes:public')
  res.json({ id: req.params.id, deleted: true })
})
app.get('/api/admin/notes', authRequired, async (req, res) => {
  if (!hasAnyNotePermission(req.user)) return res.status(403).json({ message: 'Note management access required.' })
  try {
    const snapshot = await db.collection('notes').orderBy('createdAt', 'desc').get()
    const canViewAll = req.user.role === 'admin' || req.user.role === 'content_admin' || hasNotePermission(req.user, 'editNotes') || hasNotePermission(req.user, 'deleteNotes') || hasNotePermission(req.user, 'reviewNotes')
    res.json(snapshot.docs.filter((note) => canViewAll || note.data().authorId === req.user.id).map(serialize))
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] /api/admin/notes hit quota limit.')
      return res.json([])
    }
    res.status(500).json({ message: 'Unable to load admin notes.' })
  }
})
app.get('/api/folders', authRequired, async (_req, res) => {
  try {
    const cached = getFromCache('folders:all', 60000)
    if (cached) return res.json(cached)

    const snapshot = await db.collection('folders').get()
    const folders = snapshot.docs.map(serialize).sort((left, right) => `${left.year}${left.subject}`.localeCompare(`${right.year}${right.subject}`))
    saveToCache('folders:all', folders)
    res.json(folders)
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] /api/folders hit quota limit. Serving cached/fallback folders.')
      const fallback = getStaleFallback('folders:all') || []
      return res.json(fallback)
    }
    console.error('[Folders Fetch Error]:', err.message)
    res.status(500).json({ message: 'Unable to load folders right now.' })
  }
})
app.get('/api/notices', authRequired, async (_req, res) => {
  try {
    const cached = getFromCache('notices:active', 45000)
    if (cached) return res.json(cached)

    const now = Date.now()
    const snapshot = await noticeBoardCollection().orderBy('createdAt', 'desc').get()
    const notices = snapshot.docs
      .map((doc) => {
        const notice = doc.data()
        return { id: doc.id, title: notice.title, message: notice.message, type: notice.type || 'general', createdAt: toIso(notice.createdAt), expiresAt: typeof notice.expiresAt === 'number' ? notice.expiresAt : now + noticeExpiryMs }
      })
      .filter((notice) => (notice.expiresAt || now) > now)
      .sort((left, right) => Number(right.expiresAt || 0) - Number(left.expiresAt || 0))
    saveToCache('notices:active', notices)
    res.json(notices)
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] /api/notices hit quota limit. Serving cached/fallback notices.')
      const fallback = getStaleFallback('notices:active') || []
      return res.json(fallback)
    }
    console.error('[Notices Fetch Error]:', err.message)
    res.status(500).json({ message: 'Unable to load notices right now.' })
  }
})
app.post('/api/notices', authRequired, async (req, res) => {
  if (!canManageNoticeBoard(req.user)) return res.status(403).json({ message: 'Notice board management access required.' })
  const { title, message, type } = req.body || {}
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ message: 'Notice title is required.' })
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'Notice details are required.' })
  const notice = await createNoticeRecord({ title, message, type })
  if (!notice) return res.status(400).json({ message: 'Notice could not be created.' })
  res.status(201).json(notice)
})
app.delete('/api/notices/:id', authRequired, async (req, res) => {
  if (!canManageNoticeBoard(req.user)) return res.status(403).json({ message: 'Notice board management access required.' })
  const noticeRef = noticeBoardCollection().doc(req.params.id)
  const noticeSnapshot = await noticeRef.get()
  if (!noticeSnapshot.exists) return res.status(404).json({ message: 'Notice not found.' })
  await noticeRef.delete()
  invalidateCache('notices:active')
  res.json({ id: noticeSnapshot.id, deleted: true })
})
app.patch('/api/notices/:id', authRequired, async (req, res) => {
  if (!canManageNoticeBoard(req.user)) return res.status(403).json({ message: 'Notice board management access required.' })
  const noticeRef = noticeBoardCollection().doc(req.params.id)
  const noticeSnapshot = await noticeRef.get()
  if (!noticeSnapshot.exists) return res.status(404).json({ message: 'Notice not found.' })
  const { title, message, type } = req.body || {}
  const updates = { updatedAt: FieldValue.serverTimestamp() }
  if (typeof title === 'string' && title.trim()) updates.title = title.trim()
  if (typeof message === 'string' && message.trim()) updates.message = message.trim()
  if (typeof type === 'string' && (type === 'general' || type === 'alert')) updates.type = type
  await noticeRef.update(updates)
  invalidateCache('notices:active')
  const updatedSnapshot = await noticeRef.get()
  const data = updatedSnapshot.data()
  res.json({
    id: updatedSnapshot.id,
    title: data.title,
    message: data.message,
    type: data.type || 'general',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : Date.now() + noticeExpiryMs
  })
})
app.post('/api/folders', authRequired, adminRequired, async (req, res) => {
  const { subject, year } = req.body
  if (!subject || !year) return res.status(400).json({ message: 'Subject and year are required.' })
  const existingFolders = await db.collection('folders').where('year', '==', year).get()
  if (existingFolders.docs.some((folderSnapshot) => folderSnapshot.data().subject?.trim().toLowerCase() === subject.trim().toLowerCase())) {
    return res.status(409).json({ message: 'A folder for this subject and year already exists.' })
  }
  const folder = { name: subject, subject, year, createdAt: FieldValue.serverTimestamp(), createdBy: req.user.id }
  const created = await db.collection('folders').add(folder)
  invalidateCache('folders:all')
  res.status(201).json({ id: created.id, ...folder, createdAt: new Date().toISOString() })
})
app.patch('/api/folders/:id', authRequired, adminRequired, async (req, res) => {
  const { subject, year } = req.body
  if (!subject || !year) return res.status(400).json({ message: 'Subject and year are required.' })
  const folderRef = db.collection('folders').doc(req.params.id)
  const folderSnapshot = await folderRef.get()
  if (!folderSnapshot.exists) return res.status(404).json({ message: 'Folder not found.' })
  const previousFolder = folderSnapshot.data()
  const notesSnapshot = await db.collection('notes').get()
  const linkedNotes = notesSnapshot.docs.filter((noteSnapshot) => {
    const note = noteSnapshot.data()
    return note.folderId === req.params.id || (!note.folderId && note.subject === previousFolder.subject && note.year === previousFolder.year)
  })
  for (let index = 0; index < linkedNotes.length; index += 450) {
    const batch = db.batch()
    linkedNotes.slice(index, index + 450).forEach((noteSnapshot) => batch.update(noteSnapshot.ref, { subject, year, folderId: req.params.id }))
    await batch.commit()
  }
  await folderRef.update({ name: subject, subject, year })
  invalidateCache('folders:all', 'notes:public')
  res.json({ id: req.params.id, name: subject, subject, year })
})
app.delete('/api/folders/:id', authRequired, adminRequired, async (req, res) => {
  const folderRef = db.collection('folders').doc(req.params.id)
  const folderSnapshot = await folderRef.get()
  if (!folderSnapshot.exists) return res.status(404).json({ message: 'Folder not found.' })
  const folder = folderSnapshot.data()
  const notesSnapshot = await db.collection('notes').get()
  const linkedNotes = notesSnapshot.docs.filter((noteSnapshot) => {
    const note = noteSnapshot.data()
    return note.folderId === req.params.id || (!note.folderId && note.subject === folder.subject && note.year === folder.year)
  })
  for (let index = 0; index < linkedNotes.length; index += 450) {
    const batch = db.batch()
    linkedNotes.slice(index, index + 450).forEach((noteSnapshot) => batch.delete(noteSnapshot.ref))
    await batch.commit()
  }
  await folderRef.delete()
  invalidateCache('folders:all', 'notes:public')
  res.json({ id: req.params.id, deleted: true, deletedNotes: linkedNotes.length })
})
app.get('/api/admin/users', authRequired, adminRequired, async (_req, res) => {
  const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get()
  res.json(snapshot.docs.map(serializeUser))
})
app.get('/api/admin/users/:id', authRequired, adminRequired, async (req, res, next) => {
  if (req.params.id === 'export') return next()
  const userSnapshot = await db.collection('users').doc(req.params.id).get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  const activitySnapshot = await userActivityCollection(req.params.id).orderBy('eventAt', 'desc').limit(100).get()
  const activity = activitySnapshot.docs.map((snapshot) => {
    const event = snapshot.data()
    return { id: snapshot.id, event: event.event || '', ipAddress: event.ipAddress || '', occurredAt: toIso(event.eventAt), noteId: event.noteId || '', noteTitle: event.noteTitle || '', subject: event.subject || '', year: event.year || '', course: event.course || '' }
  })
  res.json({ user: serializeUser(userSnapshot), activity })
})

// Delete single activity log for a specific user/student
app.delete('/api/admin/users/:userId/activity/:logId', authRequired, adminRequired, async (req, res) => {
  const { userId, logId } = req.params
  const logRef = userActivityCollection(userId).doc(logId)
  const logSnapshot = await logRef.get()
  if (!logSnapshot.exists) return res.status(404).json({ message: 'Activity log not found.' })
  await logRef.delete()
  res.json({ id: logId, userId, deleted: true })
})

// Delete all activity logs for a specific user/student
app.delete('/api/admin/users/:userId/activity', authRequired, adminRequired, async (req, res) => {
  const { userId } = req.params
  const activitySnapshot = await userActivityCollection(userId).get()
  const batch = db.batch()
  activitySnapshot.docs.forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
  res.json({ userId, deletedCount: activitySnapshot.size, deleted: true })
})

app.patch('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  const { name, email, mobile, college, year, branch, course, role } = req.body || {}
  if (![name, mobile, college, year, branch, course].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Name, mobile number, college, year, branch, and course are required.' })
  }
  const profile = { name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: year.trim(), branch: branch.trim(), course: course.trim() }
  if (typeof email === 'string' && email.trim() && emailPattern.test(email.trim())) {
    profile.email = email.trim().toLowerCase()
  }
  if (typeof role === 'string' && ['student', 'content_admin', 'admin'].includes(role.trim())) {
    profile.role = role.trim()
  }
  if (!isValidMobile(profile.mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
  if (profile.name.length > 120 || profile.mobile.length > 20 || profile.college.length > 200 || profile.year.length > 80 || profile.branch.length > 120 || profile.course.length > 120) {
    return res.status(400).json({ message: 'One or more profile fields are too long.' })
  }
  const userRef = db.collection('users').doc(req.params.id)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  const previousUser = userSnapshot.data()
  const before = Object.fromEntries(Object.keys(profile).map((field) => [field, previousUser[field] || '']))
  const actionRef = adminActionsCollection().doc()
  const batch = db.batch()
  batch.update(userRef, profile)
  batch.set(actionRef, {
    ...createAdminAction(req, { id: userSnapshot.id, ...previousUser }, 'user_profile_updated'),
    previousProfile: before,
    updatedProfile: profile,
    status: 'completed',
  })
  await batch.commit()
  res.json({ ...serializeUser(userSnapshot), ...profile })
})
app.patch('/api/admin/users/:id/block', authRequired, adminRequired, async (req, res) => {
  const userRef = db.collection('users').doc(req.params.id)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  const blocked = Boolean(req.body.blocked)
  const target = { id: userSnapshot.id, ...userSnapshot.data() }
  const batch = db.batch()
  batch.update(userRef, { blocked })
  batch.set(adminActionsCollection().doc(), createAdminAction(req, target, blocked ? 'user_blocked' : 'user_unblocked'))
  await batch.commit()
  res.json({ id: userSnapshot.id, blocked })
})
app.patch('/api/admin/users/:id/permissions', authRequired, adminRequired, async (req, res) => {
  const incomingPermissions = req.body?.permissions || {}
  const fullAdmin = req.body?.fullAdmin === true
  if (!incomingPermissions || typeof incomingPermissions !== 'object' || Array.isArray(incomingPermissions) || Object.keys(incomingPermissions).some((key) => !notePermissionNames.includes(key) || typeof incomingPermissions[key] !== 'boolean')) {
    return res.status(400).json({ message: 'Choose valid note permissions.' })
  }
  const permissions = Object.fromEntries(notePermissionNames.map((permission) => [permission, fullAdmin ? false : incomingPermissions[permission] === true]))
  const userRef = db.collection('users').doc(req.params.id)
  const snapshot = await userRef.get()
  if (!snapshot.exists) return res.status(404).json({ message: 'User not found.' })
  const currentUser = snapshot.data()
  if (fullAdmin && currentUser.blocked) return res.status(409).json({ message: 'Unblock this user before granting admin access.' })
  if (fullAdmin && currentUser.role !== 'admin' && !isPrimaryAdmin(req.user)) {
    const existingRequests = await adminRoleRequestsCollection().where('targetUserId', '==', snapshot.id).get()
    if (existingRequests.docs.some((request) => request.data().status === 'pending')) {
      return res.status(409).json({ message: 'An admin promotion request for this user is already pending.' })
    }
    const requestData = {
      requesterId: req.user.id,
      requesterName: req.user.name || '',
      requesterEmail: req.user.email || '',
      targetUserId: snapshot.id,
      targetName: currentUser.name || '',
      targetEmail: currentUser.email || '',
      status: 'pending',
      requestedAt: FieldValue.serverTimestamp(),
    }
    const requestRef = await adminRoleRequestsCollection().add(requestData)
    return res.status(202).json({
      id: snapshot.id,
      role: currentUser.role || 'student',
      permissions: currentUser.permissions || {},
      pendingApproval: true,
      request: { ...requestData, id: requestRef.id, requestedAt: new Date().toISOString() },
    })
  }
  const role = fullAdmin ? 'admin' : Object.values(permissions).some(Boolean) ? 'note_manager' : 'student'
  if (snapshot.id === req.user.id && currentUser.role === 'admin' && role !== 'admin') return res.status(400).json({ message: 'You cannot remove your own full admin access.' })
  if (isProtectedAdminEmail(currentUser.email) && role !== 'admin' && req.user.email?.toLowerCase() !== (currentUser.email || '').trim().toLowerCase()) {
    return res.status(403).json({ message: 'The primary admin account is protected and cannot be downgraded by another admin.' })
  }
  if (currentUser.role === 'admin' && role !== 'admin') {
    const admins = await db.collection('users').where('role', '==', 'admin').get()
    if (admins.size <= 1) return res.status(400).json({ message: 'At least one full admin account must remain.' })
  }
  const actionRef = adminActionsCollection().doc()
  const batch = db.batch()
  batch.update(userRef, { role, permissions })
  batch.set(actionRef, { ...createAdminAction(req, { id: snapshot.id, ...currentUser }, 'user_permissions_updated'), permissions, fullAdmin, status: 'completed' })
  await batch.commit()
  res.json({ id: snapshot.id, role, permissions })
})
app.get('/api/admin/admin-requests', authRequired, adminRequired, async (req, res) => {
  if (!isPrimaryAdmin(req.user)) return res.json({ canApprove: false, requests: [] })
  const snapshot = await adminRoleRequestsCollection().orderBy('requestedAt', 'desc').get()
  const requests = snapshot.docs.map(serializeAdminRoleRequest).filter((request) => request.status === 'pending')
  res.json({ canApprove: true, requests })
})
app.post('/api/admin/admin-requests/:id/decision', authRequired, adminRequired, async (req, res) => {
  if (!isPrimaryAdmin(req.user)) return res.status(403).json({ message: 'Only the main admin can review admin promotion requests.' })
  const decision = req.body?.decision
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: 'Choose approve or reject.' })
  const requestRef = adminRoleRequestsCollection().doc(req.params.id)
  const actionRef = adminActionsCollection().doc()
  let targetUserId = ''
  try {
    await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef)
      if (!requestSnapshot.exists) {
        const error = new Error('Admin promotion request not found.')
        error.statusCode = 404
        throw error
      }
      const request = requestSnapshot.data()
      if (request.status !== 'pending') {
        const error = new Error('This admin promotion request has already been reviewed.')
        error.statusCode = 409
        throw error
      }
      const userRef = db.collection('users').doc(request.targetUserId)
      const userSnapshot = await transaction.get(userRef)
      if (!userSnapshot.exists) {
        const error = new Error('The requested user no longer exists.')
        error.statusCode = 404
        throw error
      }
      const target = { id: userSnapshot.id, ...userSnapshot.data() }
      if (decision === 'approve' && target.blocked) {
        const error = new Error('Unblock this user before approving admin access.')
        error.statusCode = 409
        throw error
      }
      targetUserId = userSnapshot.id
      if (decision === 'approve' && target.role !== 'admin') {
        transaction.update(userRef, { role: 'admin', permissions: Object.fromEntries(notePermissionNames.map((permission) => [permission, false])) })
      }
      transaction.update(requestRef, {
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedById: req.user.id,
        decidedByName: req.user.name || '',
        decidedByEmail: req.user.email || '',
        decidedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(actionRef, createAdminAction(req, target, decision === 'approve' ? 'admin_promotion_approved' : 'admin_promotion_rejected'))
    })
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || 'Unable to review this request.' })
  }
  res.json({ id: req.params.id, status: decision === 'approve' ? 'approved' : 'rejected', targetUserId })
})
const archiveAndDeleteUser = async (req, userSnapshot) => {
  const userRef = userSnapshot.ref
  const actionRef = adminActionsCollection().doc()
  const userData = userSnapshot.data()
  if (isProtectedAdminEmail(userData?.email) && (req.user.email || '').toLowerCase() !== (userData.email || '').trim().toLowerCase()) {
    throw new Error('The main admin account cannot be removed by another admin.')
  }
  const { passwordHash, createdAt, ...safeUserData } = userData
  const activitySnapshot = await userActivityCollection(userSnapshot.id).get()
  const archivedActivity = activitySnapshot.docs.map((activitySnapshot) => {
    const activity = activitySnapshot.data()
    return { event: activity.event || '', ipAddress: activity.ipAddress || '', eventAt: activity.eventAt || FieldValue.serverTimestamp(), noteId: activity.noteId || '', noteTitle: activity.noteTitle || '', subject: activity.subject || '', year: activity.year || '', course: activity.course || '' }
  })
  const deletedAccountRef = deletedAccountsCollection().doc()
  await actionRef.set(createAdminAction(req, { id: userSnapshot.id, ...userData }, 'user_deleted', 'pending'))
  await deletedAccountRef.set({ ...safeUserData, originalUserId: userSnapshot.id, registeredAt: toIso(createdAt), deletedBy: req.user.id, deletedByName: req.user.name || '', deletedByEmail: req.user.email || '', deletedByIp: req.ip || '', deletionStatus: 'pending', deletedAt: FieldValue.serverTimestamp() })
  for (let index = 0; index < archivedActivity.length; index += 450) {
    const batch = db.batch()
    archivedActivity.slice(index, index + 450).forEach((activity) => batch.set(deletedAccountRef.collection('activity').doc(), activity))
    await batch.commit()
  }
  try {
    await db.recursiveDelete(userRef)
    await actionRef.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() })
    await deletedAccountRef.update({ deletionStatus: 'completed' })
  } catch {
    await actionRef.update({ status: 'failed', completedAt: FieldValue.serverTimestamp() })
    await deletedAccountRef.update({ deletionStatus: 'failed' })
    throw new Error('User deletion failed; the admin action was recorded.')
  }
  return userSnapshot.id
}

app.delete('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  const snapshot = await db.collection('users').get()
  const targets = snapshot.docs.filter((userSnapshot) => userSnapshot.data().role !== 'admin')
  let deletedCount = 0
  for (let index = 0; index < targets.length; index += 10) {
    const results = await Promise.allSettled(targets.slice(index, index + 10).map((userSnapshot) => archiveAndDeleteUser(req, userSnapshot)))
    deletedCount += results.filter((result) => result.status === 'fulfilled').length
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) return res.status(500).json({ message: `${failed.reason.message} ${deletedCount} of ${targets.length} non-admin user(s) were deleted.` })
  }
  res.json({ deletedCount })
})

app.delete('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot delete your own admin account.' })
  const userSnapshot = await db.collection('users').doc(req.params.id).get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  try {
    await archiveAndDeleteUser(req, userSnapshot)
    res.json({ id: req.params.id, deleted: true })
  } catch (error) {
    res.status(403).json({ message: error.message })
  }
})
app.get('/api/admin/users/export', authRequired, adminRequired, async (_req, res) => {
  await pruneExpiredNotices()
  const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get()
  const users = snapshot.docs.map(serialize)
  const deletedSnapshot = await deletedAccountsCollection().orderBy('deletedAt', 'desc').get()
  const deletedUsers = deletedSnapshot.docs.map((deletedDoc) => ({ id: deletedDoc.id, ...deletedDoc.data() }))
  const exportUserRow = (user, accountStatus, deletedAt = '') => ({ Name: user.name || '', Email: user.email || '', 'Mobile Number': user.mobile || '', College: user.college || '', Year: user.year || '', Branch: user.branch || '', Course: user.course || '', Role: user.role || 'student', 'Note Permissions': describeNotePermissions(user), 'Account Status': accountStatus, 'Registered At': user.registeredAt || toIso(user.createdAt), 'Deleted At': deletedAt })
  const rows = [...users.map((user) => exportUserRow(user, 'Active')), ...deletedUsers.map((user) => exportUserRow(user, user.deletionStatus === 'completed' ? 'Deleted' : `Deletion ${user.deletionStatus || 'pending'}`, toIso(user.deletedAt)))]
  const deletedUserRows = deletedUsers.map((user) => ({ ...exportUserRow(user, user.deletionStatus === 'completed' ? 'Deleted' : `Deletion ${user.deletionStatus || 'pending'}`, toIso(user.deletedAt)), 'Original User ID': user.originalUserId || '', 'Deleted By': user.deletedByName || '', 'Deleted By Email': user.deletedByEmail || '', 'Deleted By IP': user.deletedByIp || '' }))
  const notesSnapshot = await db.collection('notes').orderBy('createdAt', 'desc').get()
  const noteRows = notesSnapshot.docs.map((noteSnapshot) => {
    const note = noteSnapshot.data()
    return { Title: note.title || '', Subject: note.subject || '', Year: note.year || '', FolderId: note.folderId || '', DriveLink: note.driveLink || '', Author: note.author || '', Status: note.status || '', UploadedAt: note.createdAt?.toDate?.().toISOString() || '' }
  })
  const activityGroups = await Promise.all(snapshot.docs.map(async (userSnapshot) => {
    const user = userSnapshot.data()
    const activitySnapshot = await userActivityCollection(userSnapshot.id).orderBy('eventAt', 'asc').get()
    return activitySnapshot.docs.map((activitySnapshot) => {
      const activity = activitySnapshot.data()
      return {
        Name: user.name || '',
        Email: user.email || '',
        Course: user.course || '',
        Year: user.year || '',
        Event: activity.event || '',
        'IP Address': activity.ipAddress || '',
        'Registered At': toIso(user.createdAt),
        'Event Time': toIso(activity.eventAt),
        'Note Title': activity.noteTitle || '',
        Subject: activity.subject || '',
        'Note ID': activity.noteId || '',
      }
    })
  }))
  const archivedActivityGroups = await Promise.all(deletedSnapshot.docs.map(async (deletedUserSnapshot) => {
    const user = deletedUserSnapshot.data()
    const activitySnapshot = await deletedUserSnapshot.ref.collection('activity').orderBy('eventAt', 'asc').get()
    return activitySnapshot.docs.map((activitySnapshot) => {
      const activity = activitySnapshot.data()
      return {
        Name: user.name || '',
        Email: user.email || '',
        Course: user.course || '',
        Year: user.year || '',
        Event: activity.event || '',
        'IP Address': activity.ipAddress || '',
        'Registered At': user.registeredAt || '',
        'Event Time': toIso(activity.eventAt),
        'Note Title': activity.noteTitle || '',
        Subject: activity.subject || '',
        'Note ID': activity.noteId || '',
      }
    })
  }))
  const archivedActivityRows = archivedActivityGroups.flat()
  const activityRows = [...activityGroups.flat(), ...archivedActivityRows]
  const adminActionSnapshot = await adminActionsCollection().orderBy('occurredAt', 'asc').get()
  const adminActionRows = adminActionSnapshot.docs.map((actionSnapshot) => {
    const action = actionSnapshot.data()
    return {
      Action: action.action || '',
      Status: action.status || '',
      'Admin Name': action.actorName || '',
      'Admin Email': action.actorEmail || '',
      'Admin Mobile': action.actorMobile || '',
      'Admin User ID': action.actorId || '',
      'Target Name': action.targetName || '',
      'Target Email': action.targetEmail || '',
      'Target Mobile': action.targetMobile || '',
      'Target User ID': action.targetUserId || '',
      'IP Address': action.ipAddress || '',
      'Note Permissions': action.permissions ? describeNotePermissions({ role: action.fullAdmin ? 'admin' : 'note_manager', permissions: action.permissions }) : '',
      'Full Admin Access': action.fullAdmin ? 'Yes' : 'No',
      'Previous Profile': action.previousProfile ? JSON.stringify(action.previousProfile) : '',
      'Updated Profile': action.updatedProfile ? JSON.stringify(action.updatedProfile) : '',
      'Action Time': toIso(action.occurredAt),
      'Completed Time': toIso(action.completedAt),
    }
  })
  const adminRoleRequestSnapshot = await adminRoleRequestsCollection().orderBy('requestedAt', 'asc').get()
  const adminRoleRequestRows = adminRoleRequestSnapshot.docs.map((requestSnapshot) => {
    const request = requestSnapshot.data()
    return {
      'Requested By Admin': request.requesterName || '',
      'Requester Email': request.requesterEmail || '',
      'Requested User': request.targetName || '',
      'Requested User Email': request.targetEmail || '',
      'Request Status': request.status || 'pending',
      'Requested At': toIso(request.requestedAt),
      'Decision By': request.decidedByName || '',
      'Decision Admin Email': request.decidedByEmail || '',
      'Decision At': toIso(request.decidedAt),
    }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Students')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noteRows), 'Uploaded Notes')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(activityRows), 'User Activity')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(adminActionRows), 'Admin Actions')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(adminRoleRequestRows), 'Admin Requests')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(deletedUserRows), 'Deleted Users')
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  res.set('Cache-Control', 'no-store').header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('tech-titan-team-students.xlsx').send(output)
})

app.get('/api/admin/collections', authRequired, adminRequired, async (req, res) => {
  try {
    const collections = await db.listCollections()
    const result = await Promise.all(collections.map(async (col) => {
      const snapshot = await col.get()
      return { name: col.id, count: snapshot.size }
    }))
    if (!result.some(c => c.name === 'deletedData')) {
      const trashSnap = await db.collection('deletedData').get()
      result.unshift({ name: 'deletedData', count: trashSnap.size })
    }
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/admin/collections/:name', authRequired, adminRequired, async (req, res) => {
  try {
    const snapshot = await db.collection(req.params.name).limit(100).get()
    res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/admin/collections/deletedData/:id/restore', authRequired, adminRequired, async (req, res) => {
  try {
    const trashRef = db.collection('deletedData').doc(req.params.id)
    const trashSnap = await trashRef.get()
    if (!trashSnap.exists) return res.status(404).json({ message: 'Deleted record not found' })
    const trashData = trashSnap.data()
    
    // Restore to original
    await db.collection(trashData.originalCollection).doc(trashData.originalId).set(trashData.data)
    
    // Remove from trash
    await trashRef.delete()
    
    res.json({ success: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/admin/collections/restore/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const trashRef = db.collection('deletedData').doc(req.params.id)
    const trashSnap = await trashRef.get()
    if (!trashSnap.exists) return res.status(404).json({ message: 'Document not found in trash.' })
    
    const docData = trashSnap.data()
    if (docData.originalCollection && docData.originalId) {
      await db.collection(docData.originalCollection).doc(docData.originalId).set(docData.data || {})
    }
    await trashRef.delete()
    res.json({ success: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/admin/collections/restore-all', authRequired, adminRequired, async (req, res) => {
  try {
    const snapshot = await db.collection('deletedData').get()
    const batch = db.batch()
    snapshot.docs.forEach((doc) => {
      const docData = doc.data()
      if (docData.originalCollection && docData.originalId) {
        const originalRef = db.collection(docData.originalCollection).doc(docData.originalId)
        batch.set(originalRef, docData.data || {})
      }
      batch.delete(doc.ref)
    })
    await batch.commit()
    res.json({ success: true, count: snapshot.size })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/admin/collections/restore-category/:category', authRequired, adminRequired, async (req, res) => {
  try {
    const snapshot = await db.collection('deletedData').where('originalCollection', '==', req.params.category).get()
    const batch = db.batch()
    snapshot.docs.forEach((doc) => {
      const docData = doc.data()
      if (docData.originalCollection && docData.originalId) {
        const originalRef = db.collection(docData.originalCollection).doc(docData.originalId)
        batch.set(originalRef, docData.data || {})
      }
      batch.delete(doc.ref)
    })
    await batch.commit()
    res.json({ success: true, count: snapshot.size })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/admin/collections/:name/:id', authRequired, adminRequired, async (req, res) => {
  try {
    if (req.params.name === 'deletedData') {
      await db.collection(req.params.name).doc(req.params.id).delete()
    } else {
      const docRef = db.collection(req.params.name).doc(req.params.id)
      const docSnap = await docRef.get()
      if (docSnap.exists) {
        await db.collection('deletedData').doc(req.params.name + '_' + req.params.id).set({
          originalCollection: req.params.name,
          originalId: req.params.id,
          data: docSnap.data(),
          deletedAt: FieldValue.serverTimestamp(),
          expireAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        })
      }
      await docRef.delete()
    }
    res.json({ success: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/admin/collections/:name', authRequired, adminRequired, async (req, res) => {
  try {
    const snapshot = await db.collection(req.params.name).get()
    if (req.params.name === 'deletedData') {
      const batch = db.batch()
      snapshot.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
      return res.json({ success: true, count: snapshot.size })
    }
    
    const batch = db.batch()
    const expireAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    snapshot.docs.forEach((doc) => {
      const trashRef = db.collection('deletedData').doc(req.params.name + '_' + doc.id)
      batch.set(trashRef, {
        originalCollection: req.params.name,
        originalId: doc.id,
        data: doc.data(),
        deletedAt: FieldValue.serverTimestamp(),
        expireAt: expireAt
      })
      batch.delete(doc.ref)
    })
    await batch.commit()
    res.json({ success: true, count: snapshot.size })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/auth/request-otp', otpLimiter, async (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body || {}
    const normalizedEmail = email?.trim().toLowerCase()
    if (purpose !== 'signup') return res.status(400).json({ message: 'Email codes are only available for signup.' })
    if (!normalizedEmail) return res.status(400).json({ message: 'Email is required' })
    if (!normalizedEmail.includes('@gmail.com')) return res.status(400).json({ message: 'Enter the email that contain @gmail.com' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalizedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' })
    const code = String(crypto.randomInt(100000, 1000000))
    otpStore.set(normalizedEmail, { code, purpose, expires: Date.now() + 10 * 60 * 1000 })
    
    if (mailjet && process.env.MAILJET_SENDER_EMAIL) {
      try {
        await mailjet.post('send', { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: process.env.MAILJET_SENDER_EMAIL, Name: 'Tech Titan Team' },
            To: [{ Email: normalizedEmail }],
            Subject: '⚡ Tech Titan Team // Your Secret Access Key is ' + code,
            TextPart: `⚡ TECH TITAN TEAM — OFFICIAL VERIFICATION CODE\n\nWelcome to Tech Titan Team.\n\nYour 6-Digit Secure Passcode is:\n===================================\n          >>> ${code} <<<\n===================================\n\n🔒 This passcode expires in exactly 10 minutes.\nFor your security, never share this code with anyone.\n\nForge ahead,\nTech Titan Team`,
            HTMLPart: `
              <!DOCTYPE html>
              <html lang="en">
                <head>
                  <meta charset="UTF-8" />
                  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                  <title>Tech Titan Team Verification</title>
                </head>
                <body style="margin:0; padding:0; background-color:#080c16; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#cbd5e1;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#080c16; padding:40px 15px;">
                    <tr>
                      <td align="center">
                        <table role="presentation" width="100%" style="max-width:580px; background:linear-gradient(145deg, #0f172a 0%, #090f1f 100%); border-radius:20px; overflow:hidden; border:1.5px solid #00f2fe; box-shadow:0 20px 60px rgba(0,0,0,0.8), 0 0 35px rgba(0,242,254,0.25);">
                          <tr>
                            <td style="height:4px; background:linear-gradient(90deg, #00f2fe 0%, #38bdf8 50%, #c084fc 100%);"></td>
                          </tr>
                          <tr>
                            <td style="padding:36px 32px 20px; text-align:center;">
                              <div style="display:inline-block; padding:4px 14px; border-radius:30px; background:rgba(0,242,254,0.12); border:1px solid rgba(0,242,254,0.35); color:#00f2fe; font-size:12px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:16px;">
                                ⚡ TECH TITAN TEAM // SECURITY SYSTEM
                              </div>
                              <h1 style="margin:0; color:#f8fafc; font-size:28px; font-weight:900; letter-spacing:-0.5px;">
                                Welcome to Tech Titan Team
                              </h1>
                              <p style="margin:10px 0 0; color:#94a3b8; font-size:15px; line-height:1.5;">
                                Your single-use access cipher has been synthesized. Use this code to verify your student account.
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:10px 32px 30px; text-align:center;">
                              <div style="background:rgba(0,0,0,0.5); border:1.5px solid rgba(0,242,254,0.5); border-radius:14px; padding:24px 20px; margin:10px 0 24px; box-shadow:inset 0 0 25px rgba(0,242,254,0.15);">
                                <span style="display:block; font-size:12px; font-weight:700; color:#38bdf8; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px;">One-Time Verification Cipher</span>
                                <span style="font-family:'Courier New', Courier, monospace; font-size:42px; font-weight:900; letter-spacing:12px; color:#00f2fe; text-shadow:0 0 15px rgba(0,242,254,0.6); display:inline-block; padding-left:12px;">${code}</span>
                              </div>
                              <div style="display:inline-block; color:#fbbf24; font-size:13px; font-weight:700;">
                                ⏳ Temporal validity: 10 minutes only.
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:24px 32px; background:rgba(0,0,0,0.35); border-top:1px solid rgba(255,255,255,0.06); text-align:center;">
                              <p style="margin:0 0 10px; color:#64748b; font-size:12px; line-height:1.5;">
                                If you did not initiate this request, disregard this transmission. Never disclose this cipher to anyone.
                              </p>
                              <div style="margin-top:14px; color:#38bdf8; font-size:13px; font-weight:800;">
                                — Tech Titan Team Collective
                              </div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
              </html>
            `,
          }],
        })
        console.log(`[Mailjet] Sent OTP to ${normalizedEmail}`)
      } catch (mailErr) {
        console.error(`[Mailjet Warning] Failed to send email to ${normalizedEmail}:`, mailErr.message)
      }
    } else {
      console.log(`[Development OTP] Code for ${normalizedEmail}: ${code}`)
    }
    console.log(`[Signup OTP for ${normalizedEmail}]: ${code}`)
    res.json({ message: 'Verification code sent' })
  } catch (err) {
    console.error('[Request OTP Error]:', err)
    res.status(500).json({ message: err.message || 'Error sending verification code.' })
  }
})

app.post('/api/auth/signin', authLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !email.trim() || !password || !password.trim()) {
    return res.status(400).json({ message: 'All fields are mandatory. Please enter both email and password.' })
  }
  const normalizedEmail = email.toLowerCase().trim()
  if (!normalizedEmail.includes('@gmail.com')) {
    return res.status(400).json({ message: 'Enter the email that contain @gmail.com' })
  }
  const userRef = db.collection('users').doc(Buffer.from(normalizedEmail || '').toString('base64url'))
  const snapshot = await userRef.get()
  if (!snapshot.exists) {
    const deletedAccounts = await deletedAccountsCollection().where('email', '==', normalizedEmail || '').limit(1).get()
    if (!deletedAccounts.empty) return res.status(410).json({ message: 'This account was removed by an administrator. Please register again with the same email address.' })
    return res.status(401).json({ message: 'Email or password is incorrect.' })
  }
  if (!(await bcrypt.compare(password || '', snapshot.data().passwordHash || ''))) return res.status(401).json({ message: 'Email or password is incorrect.' })
  const user = snapshot.data()
  if (user.blocked) return res.status(403).json({ message: 'This account is blocked.' })
  await recordUserActivity(userRef.id, req, 'login')
  const token = jwt.sign({ userId: userRef.id, email: user.email }, jwtSecret)
  res.json({ token, user: { id: userRef.id, email: user.email, name: user.name, mobile: user.mobile || '', college: user.college || '', year: user.year || '', branch: user.branch || '', course: user.course || user.branch || '', role: user.role, permissions: user.permissions || {}, blocked: false } })
})

app.post('/api/auth/logout', authRequired, async (req, res) => {
  await recordUserActivity(req.user.id, req, 'logout')
  res.json({ recorded: true })
})

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ message: 'Enter your current password and a new password of at least 8 characters.' })
  }
  const userRef = db.collection('users').doc(req.user.id)
  const userSnapshot = await userRef.get()
  const user = userSnapshot.data()
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash || ''))) {
    return res.status(401).json({ message: 'Current password is incorrect.' })
  }
  if (await bcrypt.compare(newPassword, user.passwordHash || '')) {
    return res.status(400).json({ message: 'Choose a password different from your current password.' })
  }
  await userRef.update({ passwordHash: await bcrypt.hash(newPassword, 12) })
  res.json({ message: 'Password changed successfully.' })
})

app.post('/api/auth/signup', async (req, res) => {
  res.status(400).json({ message: 'Email verification is required. Request a signup code and verify it to create an account.' })
})

app.post('/api/auth/forgot-password', async (req, res) => {
  const normalizedEmail = req.body.email?.toLowerCase().trim()
  const userRef = db.collection('users').doc(Buffer.from(normalizedEmail || '').toString('base64url'))
  const snapshot = await userRef.get()
  if (snapshot.exists) {
    const resetToken = crypto.randomBytes(32).toString('hex')
    resetStore.set(resetToken, { userId: userRef.id, expires: Date.now() + 15 * 60 * 1000 })
    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/?reset=${resetToken}`
    if (mailjet && process.env.MAILJET_SENDER_EMAIL) {
      await mailjet.post('send', { version: 'v3.1' }).request({ Messages: [{ From: { Email: process.env.MAILJET_SENDER_EMAIL, Name: 'Tech Titan Team' }, To: [{ Email: normalizedEmail }], Subject: '⚡ Tech Titan Team // Password Reset Request', TextPart: `Reset your password: ${resetUrl}`, HTMLPart: `<p>Reset your password within 15 minutes:</p><p><a href="${resetUrl}">${resetUrl}</a></p>` }] })
    } else {
      console.log(`Password reset link for ${normalizedEmail}: ${resetUrl}`)
    }
  }
  res.json({ message: 'If that email has an account, a password reset link has been sent.' })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  const reset = resetStore.get(token)
  if (!reset || reset.expires < Date.now() || !password || password.length < 8) return res.status(400).json({ message: 'This reset link is invalid or expired.' })
  await db.collection('users').doc(reset.userId).update({ passwordHash: await bcrypt.hash(password, 12) })
  resetStore.delete(token)
  res.json({ message: 'Password updated. You can sign in now.' })
})

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, code, password, name, mobile, college, year, branch, course } = req.body || {}
    const normalizedEmail = email?.trim().toLowerCase()
    if (!normalizedEmail || !normalizedEmail.includes('@gmail.com')) return res.status(400).json({ message: 'Enter the email that contain @gmail.com' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalizedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' })
    if (![name, mobile, college, year, branch, course].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Name, mobile number, college, year, branch, and course are required.' })
    if (!studentYears.includes(year.trim())) return res.status(400).json({ message: 'Choose a year from 1st year to 4th year.' })
    if (!isValidMobile(mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
    if (course.trim().length > 120) return res.status(400).json({ message: 'Course must be 120 characters or fewer.' })
    if (!password || password.length < 8) return res.status(400).json({ message: 'A password of at least 8 characters is required.' })
    const record = otpStore.get(normalizedEmail)
    const normalizedCode = String(code || '').trim()
    if (!record || record.purpose !== 'signup' || record.expires < Date.now() || record.code !== normalizedCode) return res.status(401).json({ message: 'Invalid or expired code' })
    otpStore.delete(normalizedEmail)
    const userRef = db.collection('users').doc(Buffer.from(normalizedEmail).toString('base64url'))
    const existing = await userRef.get()
    if (existing.exists) return res.status(409).json({ message: 'An account already exists for this email. Sign in instead.' })
    const user = { email: normalizedEmail, name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: year.trim(), branch: branch.trim(), course: course.trim(), passwordHash: await bcrypt.hash(password, 12), role: adminEmails.has(normalizedEmail) ? 'admin' : 'student', blocked: false, createdAt: FieldValue.serverTimestamp() }
    const registrationBatch = db.batch()
    registrationBatch.set(userRef, user)
    try {
      registrationBatch.set(userActivityCollection(userRef.id).doc(), createActivityRecord('registered', req, { year: user.year, course: user.course }))
    } catch (actErr) {
      console.warn('[Activity log warning]:', actErr.message)
    }
    await registrationBatch.commit()
    const token = jwt.sign({ userId: userRef.id, email: normalizedEmail }, jwtSecret)
    res.json({ token, user: { id: userRef.id, email: user.email, name: user.name, mobile: user.mobile, college: user.college, year: user.year, branch: user.branch, course: user.course, role: user.role, permissions: user.permissions || {}, blocked: false } })
  } catch (err) {
    console.error('[Verify OTP Error]:', err)
    res.status(500).json({ message: err.message || 'Error completing account registration.' })
  }
})

app.patch('/api/me', authRequired, async (req, res) => {
  const { name, mobile, college, year, branch, course } = req.body
  if (![name, mobile, college, year, branch, course].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Name, mobile number, college, year, branch, and course are required.' })
  }
  const profile = { name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: typeof year === 'string' ? year.trim() : '', branch: branch.trim(), course: course.trim() }
  if (!isValidMobile(profile.mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
  if (profile.course.length > 120) return res.status(400).json({ message: 'Course must be 120 characters or fewer.' })
  await db.collection('users').doc(req.user.id).update(profile)
  res.json({ id: req.user.id, email: req.user.email, ...profile, role: req.user.role })
})

// --- THREAT MITIGATION: GLOBAL ERROR HANDLER & INFORMATION DISCLOSURE GUARD ---
// Intercepts all unhandled exceptions, sanitizes CORS rejections, and prevents stack trace leakage
app.use((err, req, res, _next) => {
  console.error('[Global Security Guard]:', err.message || err)
  if (res.headersSent) return
  if (err.message && err.message.toLowerCase().includes('cors')) {
    return res.status(403).json({ message: 'Cross-Origin Request Blocked by Security Policy' })
  }
  if (isQuotaError(err)) {
    return res.status(503).json({
      message: 'Database quota limit reached. Operations will resume automatically as quotas refresh.',
      code: 'QUOTA_EXCEEDED'
    })
  }
  const statusCode = err.status || err.statusCode || 500
  res.status(statusCode).json({
    message: statusCode === 500 ? 'An unexpected internal server error occurred.' : err.message,
  })
})

const ensureAdmin = async () => {
  try {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return
    const email = process.env.ADMIN_EMAIL.toLowerCase().trim()
    const userRef = db.collection('users').doc(Buffer.from(email).toString('base64url'))
    const existingUser = await userRef.get()
    if (existingUser.exists) {
      await userRef.set({ email, role: 'admin', blocked: false, mobile: '' }, { merge: true })
    } else {
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
      await userRef.set({ email, name: process.env.ADMIN_NAME || 'Nexus Core Admin', mobile: '', passwordHash, role: 'admin', blocked: false, college: '', year: '', branch: '', createdAt: FieldValue.serverTimestamp() })
    }
    console.log(`Admin account ready for ${email}`)
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Quota Guard] ensureAdmin deferred due to quota limit.')
      return
    }
    console.warn('[ensureAdmin Warning]:', err.message)
  }
}

const startServer = async () => {
  try {
    if (isFirebaseReady()) {
      await ensureAdmin()
      await pruneExpiredNotices()
    } else {
      console.warn('[Startup] Database credentials pending in Render environment. API server is active; configure FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render dashboard to activate database.')
    }
  } catch (err) {
    console.warn('[Startup Warning]:', err.message)
  }

  setInterval(() => {
    if (isFirebaseReady()) {
      pruneExpiredNotices().catch(() => {})
    }
  }, 60 * 60 * 1000)

  app.listen(port, () => console.log(`Nexus Core API running on http://localhost:${port}`))
}

startServer().catch((error) => { console.error('Server bootstrap failed:', error.message); process.exit(1) })
