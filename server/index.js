import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import Mailjet from 'node-mailjet'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as XLSX from 'xlsx'

const app = express()
const port = process.env.PORT || 5000
app.set('trust proxy', process.env.RENDER ? 1 : false)
const otpStore = new Map()
const resetStore = new Map()
const mailjet = process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY
  ? Mailjet.apiConnect(process.env.MAILJET_API_KEY, process.env.MAILJET_SECRET_KEY)
  : null
const firebaseApp = getApps().length ? getApps()[0] : initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore(firebaseApp)
const adminEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
const normalizeMobile = (value) => typeof value === 'string' ? value.trim() : ''
const isValidMobile = (value) => {
  const mobile = normalizeMobile(value)
  const digitCount = (mobile.match(/\d/g) || []).length
  return mobile.length <= 20 && /^\+?[0-9][0-9\s().-]*$/.test(mobile) && digitCount >= 7 && digitCount <= 15
}
const toIso = (value) => value?.toDate?.().toISOString() || (typeof value === 'string' ? value : '')
const userActivityCollection = (userId) => db.collection('users').doc(userId).collection('activity')
const adminActionsCollection = () => db.collection('adminActions')
const deletedAccountsCollection = () => db.collection('deletedAccounts')
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

const allowedClientOrigins = new Set([
  ...(process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean),
  'https://notessharingroup.onrender.com',
])
app.use(cors({
  origin(origin, callback) {
    const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')
    if (!origin || allowedClientOrigins.has(origin) || isLocalOrigin) return callback(null, true)
    return callback(new Error('Origin is not allowed by CORS.'))
  },
}))
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tech-titan-team' }))

const authRequired = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token
    const identity = jwt.verify(token, process.env.JWT_SECRET || 'development-secret')
    const snapshot = await db.collection('users').doc(identity.userId).get()
    if (!snapshot.exists || snapshot.data().blocked) return res.status(403).json({ message: 'This account is blocked.' })
    req.user = { id: snapshot.id, ...snapshot.data() }
    next()
  } catch {
    res.status(401).json({ message: 'Sign in required.' })
  }
}

const adminRequired = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ message: 'Admin access required.' })
const contentAdminRequired = (req, res, next) => ['admin', 'content_admin'].includes(req.user?.role) ? next() : res.status(403).json({ message: 'Content admin access required.' })
const serialize = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

app.get('/api/notes', authRequired, async (_req, res) => {
  const snapshot = await db.collection('notes').where('status', '==', 'approved').get()
  res.json(snapshot.docs.map(serialize).sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))))
})
app.post('/api/notes/:id/access', authRequired, async (req, res) => {
  const noteSnapshot = await db.collection('notes').doc(req.params.id).get()
  if (!noteSnapshot.exists || noteSnapshot.data().status !== 'approved') return res.status(404).json({ message: 'Note not found.' })
  const note = noteSnapshot.data()
  await recordUserActivity(req.user.id, req, 'note_access', { noteId: noteSnapshot.id, noteTitle: note.title || '', subject: note.subject || '' })
  res.json({ recorded: true })
})
app.post('/api/notes', authRequired, async (req, res) => {
  const { title, subject, year, folderId, driveLink, status } = req.body
  if (!title || !subject || !year || !driveLink) return res.status(400).json({ message: 'Title, year, subject, and Drive link are required.' })
  if (['admin', 'content_admin'].includes(req.user.role)) {
    if (!folderId) return res.status(400).json({ message: 'Choose a subject folder for this note.' })
    const folderSnapshot = await db.collection('folders').doc(folderId).get()
    const folder = folderSnapshot.data()
    if (!folderSnapshot.exists || folder.year !== year || folder.subject !== subject) return res.status(400).json({ message: 'The selected folder does not match this note year and subject.' })
  }
  const note = { title, subject, year, folderId: folderId || '', driveLink, author: req.user.name || req.user.email, authorId: req.user.id, status: ['admin', 'content_admin'].includes(req.user.role) && status === 'approved' ? 'approved' : 'pending', createdAt: FieldValue.serverTimestamp() }
  const created = await db.collection('notes').add(note)
  res.status(201).json({ id: created.id, ...note, createdAt: new Date().toISOString() })
})
app.patch('/api/notes/:id', authRequired, contentAdminRequired, async (req, res) => {
  if (req.user.role === 'content_admin') {
    const editableFields = ['title', 'driveLink']
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    if (Object.keys(body).some((field) => !editableFields.includes(field)) || typeof body.title !== 'string' || !body.title.trim() || typeof body.driveLink !== 'string' || !body.driveLink.trim()) {
      return res.status(400).json({ message: 'Content admins can edit only a note title and Drive link.' })
    }
  }
  const changes = { ...req.body }
  if ('folderId' in changes || 'subject' in changes || 'year' in changes) {
    if (typeof changes.folderId !== 'string' || !changes.folderId) return res.status(400).json({ message: 'Choose a subject folder for this note.' })
    const folderSnapshot = await db.collection('folders').doc(changes.folderId).get()
    if (!folderSnapshot.exists) return res.status(400).json({ message: 'The selected folder no longer exists.' })
    changes.folderId = folderSnapshot.id
    changes.subject = folderSnapshot.data().subject
    changes.year = folderSnapshot.data().year
  }
  await db.collection('notes').doc(req.params.id).update(changes)
  res.json({ id: req.params.id, ...changes })
})
app.delete('/api/notes/:id', authRequired, contentAdminRequired, async (req, res) => {
  await db.collection('notes').doc(req.params.id).delete()
  res.json({ id: req.params.id, deleted: true })
})
app.get('/api/admin/notes', authRequired, contentAdminRequired, async (_req, res) => {
  const snapshot = await db.collection('notes').orderBy('createdAt', 'desc').get()
  res.json(snapshot.docs.map(serialize))
})
app.get('/api/folders', authRequired, async (_req, res) => {
  const snapshot = await db.collection('folders').get()
  const folders = snapshot.docs.map(serialize)
  res.json(folders.sort((left, right) => `${left.year}${left.subject}`.localeCompare(`${right.year}${right.subject}`)))
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
    return { id: snapshot.id, event: event.event || '', ipAddress: event.ipAddress || '', occurredAt: toIso(event.eventAt), noteId: event.noteId || '', noteTitle: event.noteTitle || '', subject: event.subject || '' }
  })
  res.json({ user: serializeUser(userSnapshot), activity })
})
app.patch('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  const { name, mobile, college, year, branch } = req.body || {}
  if (![name, mobile, college, year, branch].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Name, mobile number, college, year, and branch are required.' })
  }
  const profile = { name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: year.trim(), branch: branch.trim() }
  if (!isValidMobile(profile.mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
  if (profile.name.length > 120 || profile.mobile.length > 20 || profile.college.length > 200 || profile.year.length > 80 || profile.branch.length > 120) {
    return res.status(400).json({ message: 'One or more profile fields are too long.' })
  }
  const userRef = db.collection('users').doc(req.params.id)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  await userRef.update(profile)
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
app.patch('/api/admin/users/:id/role', authRequired, adminRequired, async (req, res) => {
  const { role } = req.body
  if (!['student', 'content_admin'].includes(role)) return res.status(400).json({ message: 'Choose student or content admin access.' })
  const userRef = db.collection('users').doc(req.params.id)
  const snapshot = await userRef.get()
  if (!snapshot.exists) return res.status(404).json({ message: 'User not found.' })
  if (snapshot.data().role === 'admin') return res.status(400).json({ message: 'Full admin roles cannot be changed here.' })
  await userRef.update({ role })
  res.json({ id: req.params.id, role })
})
app.delete('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot delete your own admin account.' })
  const userRef = db.collection('users').doc(req.params.id)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) return res.status(404).json({ message: 'User not found.' })
  const actionRef = adminActionsCollection().doc()
  await actionRef.set(createAdminAction(req, { id: userSnapshot.id, ...userSnapshot.data() }, 'user_deleted', 'pending'))
  await deletedAccountsCollection().doc(userSnapshot.id).set({ email: userSnapshot.data().email || '', deletedAt: FieldValue.serverTimestamp() })
  try {
    await db.recursiveDelete(userRef)
    await actionRef.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() })
  } catch {
    await actionRef.update({ status: 'failed', completedAt: FieldValue.serverTimestamp() })
    return res.status(500).json({ message: 'User deletion failed; the admin action was recorded.' })
  }
  res.json({ id: req.params.id, deleted: true })
})
app.get('/api/admin/users/export', authRequired, adminRequired, async (_req, res) => {
  const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get()
  const users = snapshot.docs.map(serialize)
  const rows = users.map((user) => ({ Name: user.name || '', Email: user.email || '', 'Mobile Number': user.mobile || '', College: user.college || '', Year: user.year || '', Branch: user.branch || '', Role: user.role || 'student', Blocked: user.blocked ? 'Yes' : 'No' }))
  const notesSnapshot = await db.collection('notes').orderBy('createdAt', 'desc').get()
  const noteRows = notesSnapshot.docs.map((noteSnapshot) => {
    const note = noteSnapshot.data()
    return { Title: note.title || '', Subject: note.subject || '', Year: note.year || '', FolderId: note.folderId || '', DriveLink: note.driveLink || '', Author: note.author || '', Status: note.status || '', UploadedAt: note.createdAt?.toDate?.().toISOString() || '' }
  })
  const activityRows = []
  for (const userSnapshot of snapshot.docs) {
    const user = userSnapshot.data()
    const activitySnapshot = await userActivityCollection(userSnapshot.id).orderBy('eventAt', 'asc').get()
    activitySnapshot.docs.forEach((activitySnapshot) => {
      const activity = activitySnapshot.data()
      activityRows.push({
        Name: user.name || '',
        Email: user.email || '',
        Event: activity.event || '',
        'IP Address': activity.ipAddress || '',
        'Registered At': toIso(user.createdAt),
        'Event Time': toIso(activity.eventAt),
        'Note Title': activity.noteTitle || '',
        Subject: activity.subject || '',
        'Note ID': activity.noteId || '',
      })
    })
  }
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
      'Action Time': toIso(action.occurredAt),
      'Completed Time': toIso(action.completedAt),
    }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Students')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noteRows), 'Uploaded Notes')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(activityRows), 'User Activity')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(adminActionRows), 'Admin Actions')
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('tech-titan-team-students.xlsx').send(output)
})

app.post('/api/auth/request-otp', async (req, res) => {
  const { email, purpose = 'signup' } = req.body
  const normalizedEmail = email?.trim().toLowerCase()
  if (purpose !== 'signup') return res.status(400).json({ message: 'Email codes are only available for signup.' })
  if (!normalizedEmail) return res.status(400).json({ message: 'Email is required' })
  if (!/^[^\s@]+@gmail\.com$/i.test(normalizedEmail)) return res.status(400).json({ message: 'Only valid @gmail.com addresses can receive a signup code.' })
  const code = String(crypto.randomInt(100000, 1000000))
  otpStore.set(normalizedEmail, { code, purpose, expires: Date.now() + 10 * 60 * 1000 })
  if (mailjet && process.env.MAILJET_SENDER_EMAIL) {
    await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: process.env.MAILJET_SENDER_EMAIL, Name: 'Tech Titan Team' },
        To: [{ Email: normalizedEmail }],
        Subject: 'Your Tech Titan Team verification code',
        TextPart: `Your verification code is ${code}. It expires in 10 minutes.`,
        HTMLPart: `<h2>Your verification code: ${code}</h2><p>This code expires in 10 minutes.</p>`,
      }],
    })
  } else {
    console.log(`Development OTP for ${normalizedEmail}: ${code}`)
  }
  res.json({ message: 'Verification code sent' })
})

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body
  const normalizedEmail = email?.toLowerCase().trim()
  const userRef = db.collection('users').doc(Buffer.from(normalizedEmail || '').toString('base64url'))
  const snapshot = await userRef.get()
  if (!snapshot.exists) {
    const deletedAccount = await deletedAccountsCollection().doc(userRef.id).get()
    if (deletedAccount.exists) return res.status(410).json({ message: 'This account was removed by an administrator. Please register again with the same email address.' })
    return res.status(401).json({ message: 'Email or password is incorrect.' })
  }
  if (!(await bcrypt.compare(password || '', snapshot.data().passwordHash || ''))) return res.status(401).json({ message: 'Email or password is incorrect.' })
  const user = snapshot.data()
  if (user.blocked) return res.status(403).json({ message: 'This account is blocked.' })
  await recordUserActivity(userRef.id, req, 'login')
  const token = jwt.sign({ userId: userRef.id, email: user.email }, process.env.JWT_SECRET || 'development-secret')
  res.json({ token, user: { id: userRef.id, email: user.email, name: user.name, mobile: user.mobile || '', college: user.college || '', year: user.year || '', branch: user.branch || '', role: user.role, blocked: false } })
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
      await mailjet.post('send', { version: 'v3.1' }).request({ Messages: [{ From: { Email: process.env.MAILJET_SENDER_EMAIL, Name: 'Tech Titan Team' }, To: [{ Email: normalizedEmail }], Subject: 'Reset your Tech Titan Team password', TextPart: `Reset your password: ${resetUrl}`, HTMLPart: `<p>Reset your password within 15 minutes:</p><p><a href="${resetUrl}">${resetUrl}</a></p>` }] })
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
  const { email, code, password, name, mobile, college, year, branch } = req.body
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail || !/^[^\s@]+@gmail\.com$/i.test(normalizedEmail)) return res.status(400).json({ message: 'Use a valid Gmail address.' })
  if (![name, mobile, college, year, branch].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Name, mobile number, college, year, and branch are required.' })
  if (!isValidMobile(mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
  if (!password || password.length < 8) return res.status(400).json({ message: 'A password of at least 8 characters is required.' })
  const record = otpStore.get(normalizedEmail)
  if (!record || record.purpose !== 'signup' || record.expires < Date.now() || record.code !== code) return res.status(401).json({ message: 'Invalid or expired code' })
  otpStore.delete(normalizedEmail)
  const userRef = db.collection('users').doc(Buffer.from(normalizedEmail).toString('base64url'))
  const existing = await userRef.get()
  if (existing.exists) return res.status(409).json({ message: 'An account already exists for this email. Sign in instead.' })
  const user = { email: normalizedEmail, name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: typeof year === 'string' ? year.trim() : '', branch: branch.trim(), passwordHash: await bcrypt.hash(password, 12), role: adminEmails.has(normalizedEmail) ? 'admin' : 'student', blocked: false, createdAt: FieldValue.serverTimestamp() }
  const registrationBatch = db.batch()
  registrationBatch.set(userRef, user)
  registrationBatch.set(userActivityCollection(userRef.id).doc(), createActivityRecord('registered', req))
  registrationBatch.delete(deletedAccountsCollection().doc(userRef.id))
  await registrationBatch.commit()
  const responseUser = { id: userRef.id, ...user, createdAt: undefined }
  const token = jwt.sign({ userId: userRef.id, email: normalizedEmail }, process.env.JWT_SECRET || 'development-secret')
  res.json({ token, user: { id: userRef.id, email: user.email, name: user.name, mobile: user.mobile, college: user.college, year: user.year, branch: user.branch, role: user.role, blocked: false } })
})

app.patch('/api/me', authRequired, async (req, res) => {
  const { name, mobile, college, year, branch } = req.body
  if (![name, mobile, college, year, branch].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Name, mobile number, college, year, and branch are required.' })
  }
  const profile = { name: name.trim(), mobile: normalizeMobile(mobile), college: college.trim(), year: typeof year === 'string' ? year.trim() : '', branch: branch.trim() }
  if (!isValidMobile(profile.mobile)) return res.status(400).json({ message: 'Enter a valid mobile number with 7 to 15 digits.' })
  await db.collection('users').doc(req.user.id).update(profile)
  res.json({ id: req.user.id, email: req.user.email, ...profile, role: req.user.role })
})

const ensureAdmin = async () => {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return
  const email = process.env.ADMIN_EMAIL.toLowerCase().trim()
  const userRef = db.collection('users').doc(Buffer.from(email).toString('base64url'))
  const existingUser = await userRef.get()
  if (existingUser.exists) {
    await userRef.set({ email, role: 'admin', blocked: false, mobile: '' }, { merge: true })
  } else {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
    await userRef.set({ email, name: process.env.ADMIN_NAME || 'Tech Titan Admin', mobile: '', passwordHash, role: 'admin', blocked: false, college: '', year: '', branch: '', createdAt: FieldValue.serverTimestamp() })
  }
  console.log(`Admin account ready for ${email}`)
}

ensureAdmin().then(() => app.listen(port, () => console.log(`Tech Titan Team API running on http://localhost:${port}`))).catch((error) => { console.error('Admin bootstrap failed:', error.message); process.exit(1) })
