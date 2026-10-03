import React, { useEffect, useState } from 'react'
import {
  ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, Download, FileText,
  GraduationCap, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, Pencil, Plus,
  Search, Settings2, ShieldCheck, Sparkles, UploadCloud, Users, X, Zap,
} from 'lucide-react'
import { changePassword, createFolder, createNote, deleteAdminUser, deleteFolder, deleteNote, forgotPassword, getAdminNotes, getAdminUserDetails, getAdminUsers, getExportUrl, getFolders, getNotes, recordLogout, recordNoteAccess, requestSignupCode, resetPassword, setUserBlocked, setUserRole, signIn, signUp, updateAdminUser, updateFolder, updateNote, updateProfile, verifySignupCode } from './api'

const years = ['1st year', '2nd year', '3rd year', '4th year']
const subjects = ['Data Structures', 'Database Systems', 'Operating Systems', 'Web Development']
const uploadLink = 'https://www.playbook.com/jnpboy/drop'
const gmailPattern = /^[^\s@]+@gmail\.com$/i
const userMatchesQuery = (user, query) => {
  const normalizedQuery = query.trim().toLowerCase()
  return !normalizedQuery || [user.name, user.email, user.college, user.year, user.branch, user.role]
    .some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
}
const notes = [
  { title: 'The complete DBMS revision sheet', subject: 'Database Systems', author: 'Aarav Mehta', pages: '18 pages', color: 'coral', type: 'PDF' },
  { title: 'DSA patterns for placement season', subject: 'Data Structures', author: 'Meera Iyer', pages: '24 pages', color: 'blue', type: 'PDF' },
  { title: 'Operating systems, made visual', subject: 'Operating Systems', author: 'Kabir Shah', pages: '12 pages', color: 'yellow', type: 'PDF' },
  { title: 'Build your first MERN project', subject: 'Web Development', author: 'Tanya Rao', pages: '32 pages', color: 'green', type: 'LINK' },
]
const students = [
  { name: 'Aarav Mehta', branch: 'Computer Science', year: '3rd year', initials: 'AM', color: 'coral', score: '92%' },
  { name: 'Meera Iyer', branch: 'Information Technology', year: '2nd year', initials: 'MI', color: 'blue', score: '88%' },
  { name: 'Kabir Shah', branch: 'Computer Science', year: '4th year', initials: 'KS', color: 'yellow', score: '95%' },
]

function App() {
  const [view, setView] = useState('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [subject, setSubject] = useState('All notes')
  const [search, setSearch] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('tech-titan-session') || 'null'))
  const [liveNotes, setLiveNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [adminUsers, setAdminUsers] = useState([])
  const [adminNotes, setAdminNotes] = useState([])
  const [notice, setNotice] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const signedIn = Boolean(session?.token)
  const isAdmin = session?.user?.role === 'admin'
  const canManageContent = isAdmin || session?.user?.role === 'content_admin'

  useEffect(() => {
    if (!session?.token) return
    let active = true
    let initialized = false
    let knownNoteIds = new Set()
    const refreshNotes = () => getNotes(session.token).then((nextNotes) => {
      if (!active) return
      const hasNewNotes = nextNotes.some((note) => !knownNoteIds.has(note.id || note.title))
      if (initialized && hasNewNotes) setNotice('New notes are available in your subject room.')
      knownNoteIds = new Set(nextNotes.map((note) => note.id || note.title))
      initialized = true
      setConnectionError('')
      setLiveNotes(nextNotes)
    }).catch((error) => {
      if (active && error.code === 'API_UNREACHABLE') setConnectionError(error.message)
    })
    refreshNotes()
    const refreshTimer = window.setInterval(refreshNotes, 5000)
    getFolders(session.token).then(setFolders).catch(() => setFolders([]))
    if (isAdmin) getAdminUsers(session.token).then(setAdminUsers).catch(() => setAdminUsers([]))
    if (canManageContent) getAdminNotes(session.token).then(setAdminNotes).catch(() => setAdminNotes([]))
    return () => { active = false; window.clearInterval(refreshTimer) }
  }, [session, isAdmin, canManageContent, connectionAttempt])

  const navigate = (nextView) => {
    if (nextView === 'admin' && !canManageContent) {
      setNotice('Admin panel access is restricted.')
      setAuthOpen(true)
      return
    }
    if ((nextView === 'notes' || nextView === 'students') && !signedIn) {
      setNotice('Sign in with your college email to access the student room.')
      setAuthOpen(true)
      return
    }
    setView(nextView)
  }

  const handleAuthSuccess = (nextSession) => {
    localStorage.setItem('tech-titan-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setAuthOpen(false)
    setNotice('')
    setView('notes')
  }

  const handleProfileSave = async (profile) => {
    const updatedProfile = await updateProfile(profile, session.token)
    const nextSession = { ...session, user: { ...session.user, ...updatedProfile, email: session.user.email } }
    localStorage.setItem('tech-titan-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setNotice('Profile updated.')
  }

  const handleSignOut = async () => {
    let logoutError = ''
    try { await recordLogout(session.token) } catch (error) { logoutError = error.message }
    localStorage.removeItem('tech-titan-session')
    setSession(null)
    setView('home')
    setNotice(logoutError ? `Signed out, but activity could not be recorded: ${logoutError}` : 'You have been signed out.')
  }

  const handleNoteAccess = (note) => {
    if (!note.id) return
    recordNoteAccess(note.id, session.token).catch((error) => setNotice(`Note access could not be recorded: ${error.message}`))
  }

  const handleUpdateAdminUser = async (id, profile) => {
    const updated = await updateAdminUser(id, profile, session.token)
    setAdminUsers((current) => current.map((user) => user.id === id ? { ...user, ...updated } : user))
    setNotice('User details updated.')
    return updated
  }

  const handleCreateNote = async (note) => {
    try {
      await createNote(note, session.token)
      setAdminOpen(false)
      setNotice('Your Drive link was submitted for admin review.')
    } catch (error) {
      setNotice(error.message)
    }
  }

  const handleCreateFolder = async (folder) => {
    try {
      if (folders.some((item) => item.year === folder.year && item.subject.trim().toLowerCase() === folder.subject.trim().toLowerCase())) {
        throw new Error('A folder for this subject and year already exists.')
      }
      const created = await createFolder(folder, session.token)
      setFolders((current) => [...current, created].sort((left, right) => `${left.year}${left.subject}`.localeCompare(`${right.year}${right.subject}`)))
      setNotice('Subject folder created for students.')
    } catch (error) { setNotice(error.message) }
  }

  const handleAdminNote = async (note) => {
    try {
      const folder = folders.find((item) => item.id === note.folderId)
      if (!folder) throw new Error('Create the matching year folder before publishing this note.')
      const created = await createNote({ ...note, year: folder.year, subject: folder.subject, folderId: folder.id, status: 'approved' }, session.token)
      setAdminNotes((current) => [created, ...current])
      setLiveNotes((current) => [created, ...current])
      setNotice('Note published. Students will see it in their subject room shortly.')
      return true
    } catch (error) { setNotice(error.message); return false }
  }

  const handleNoteStatus = async (id, status) => {
    try {
      await updateNote(id, { status }, session.token)
      setAdminNotes((current) => current.map((note) => note.id === id ? { ...note, status } : note))
      if (status === 'approved') setLiveNotes((current) => [...current, adminNotes.find((note) => note.id === id)].filter(Boolean))
      else setLiveNotes((current) => current.filter((note) => note.id !== id))
      setNotice(`Note ${status}.`)
    } catch (error) { setNotice(error.message) }
  }

  const handleEditFolder = async (folder) => {
    const subject = window.prompt('Subject name', folder.subject)
    const year = window.prompt('Student year', folder.year)
    if (!subject || !year) return
    try {
      const updated = await updateFolder(folder.id, { subject, year }, session.token)
      const belongsToFolder = (note) => note.folderId === folder.id || (!note.folderId && note.subject === folder.subject && note.year === folder.year)
      setFolders((current) => current.map((item) => item.id === folder.id ? { ...item, ...updated } : item))
      setAdminNotes((current) => current.map((note) => belongsToFolder(note) ? { ...note, subject, year, folderId: folder.id } : note))
      setLiveNotes((current) => current.map((note) => belongsToFolder(note) ? { ...note, subject, year, folderId: folder.id } : note))
      setNotice('Subject and linked notes updated.')
    } catch (error) { setNotice(error.message) }
  }

  const handleDeleteFolder = async (folder) => {
    if (!window.confirm(`Delete ${folder.subject} and every note in it?`)) return
    try {
      const result = await deleteFolder(folder.id, session.token)
      const belongsToFolder = (note) => note.folderId === folder.id || (!note.folderId && note.subject === folder.subject && note.year === folder.year)
      setFolders((current) => current.filter((item) => item.id !== folder.id))
      setAdminNotes((current) => current.filter((note) => !belongsToFolder(note)))
      setLiveNotes((current) => current.filter((note) => !belongsToFolder(note)))
      setNotice(`Subject and ${result.deletedNotes} linked note(s) deleted.`)
    } catch (error) { setNotice(error.message) }
  }

  const handleEditNote = async (note) => {
    const { id, ...changes } = note
    try {
      const updated = await updateNote(id, changes, session.token)
      setAdminNotes((current) => current.map((item) => item.id === id ? { ...item, ...updated } : item))
      setLiveNotes((current) => current.map((item) => item.id === id ? { ...item, ...updated } : item))
      setNotice('Published note updated.')
      return true
    } catch (error) { setNotice(error.message); return false }
  }

  const handleDeleteNote = async (note) => {
    if (!window.confirm(`Delete ${note.title}?`)) return
    try { await deleteNote(note.id, session.token); setAdminNotes((current) => current.filter((item) => item.id !== note.id)); setLiveNotes((current) => current.filter((item) => item.id !== note.id)); setNotice('Published note deleted.') } catch (error) { setNotice(error.message) }
  }

  const handleSetContentRole = async (id, role) => {
    try {
      await setUserRole(id, role, session.token)
      setAdminUsers((users) => users.map((user) => user.id === id ? { ...user, role } : user))
      setNotice(role === 'content_admin' ? 'Note manager access granted. User must sign in again.' : 'Note manager access removed.')
    } catch (error) { setNotice(error.message) }
  }

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Go to home">
          <span className="brand-mark"><Zap size={18} fill="currentColor" /></span>
          <span>notes sharing <i>group</i></span>
        </button>
        <nav className="desktop-nav" aria-label="Primary navigation">
            {[['notes', 'Notes'], ['students', 'Students'], ...(canManageContent ? [['admin', 'Admin']] : [])].map(([key, label]) => (
              <button key={key} className="nav-link" onClick={() => scrollTo(key)}>{label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="icon-button mobile-menu" aria-label="Toggle menu" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Menu size={19} /></button>
          {signedIn ? <><button className="profile-chip" onClick={() => navigate('profile')}><span className="avatar tiny">{session.user?.name?.slice(0, 2).toUpperCase() || 'TT'}</span><span>{session.user?.name || 'Student'}</span><ChevronDown size={15} /></button><button className="signout-button" onClick={handleSignOut}><LogOut size={16} /> Sign out</button></> : <button className="button button-dark" onClick={() => setAuthOpen(true)}>Sign in <ArrowUpRight size={16} /></button>}
        </div>
      </header>
      {mobileNavOpen && <nav className="mobile-nav" aria-label="Mobile navigation">{[['notes', 'Notes'], ['students', 'Students'], ...(canManageContent ? [['admin', 'Admin']] : [])].map(([key, label]) => <button key={key} onClick={() => { scrollTo(key); setMobileNavOpen(false) }}>{label}</button>)}</nav>}

      <main>
        {view === 'profile' && signedIn ? <ProfileView user={session.user} onSave={handleProfileSave} onBack={() => setView('home')} /> : <>
        <div id="home"><Home onExplore={() => scrollTo('notes')} onSignIn={() => setAuthOpen(true)} signedIn={signedIn} /></div>
        <div id="notes">{signedIn ? <NotesView subject={subject} setSubject={setSubject} search={search} setSearch={setSearch} studentYear={session.user?.year} folders={folders} notes={[...liveNotes, ...notes].filter((note, index, list) => list.findIndex((item) => item.title === note.title) === index)} connectionError={connectionError} onRetry={() => setConnectionAttempt((attempt) => attempt + 1)} onNoteAccess={handleNoteAccess} /> : <section className="page-width access-section"><LockKeyhole size={22} /><h2>Sign in to enter the notes room.</h2><p>Use the sign-in button above to access notes and your student space.</p></section>}</div>
        <div id="students">{signedIn && <StudentsView onProfile={() => navigate('profile')} />}</div>
        {isAdmin && <div id="admin"><AdminView users={adminUsers} notes={adminNotes} folders={folders} token={session.token} onCreateFolder={handleCreateFolder} onCreateNote={handleAdminNote} onNoteStatus={handleNoteStatus} onEditFolder={handleEditFolder} onDeleteFolder={handleDeleteFolder} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} onUpdateUser={handleUpdateAdminUser} onBlock={async (id, blocked) => { await setUserBlocked(id, blocked, session.token); setAdminUsers((users) => users.map((user) => user.id === id ? { ...user, blocked } : user)) }} onDelete={async (id) => { try { await deleteAdminUser(id, session.token); setAdminUsers((users) => users.filter((user) => user.id !== id)); setNotice('User deleted from access management.') } catch (error) { setNotice(error.message) } }} /></div>}
        {isAdmin && <ContentAdminManager users={adminUsers} onSetRole={handleSetContentRole} />}
        {session?.user?.role === 'content_admin' && <div id="admin"><ContentAdminView folders={folders} notes={adminNotes} onCreateNote={handleAdminNote} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} /></div>}
        </>}
      </main>

      <UploadCta />

      <footer><span>© 2026 Notes Sharing Group</span><span className="footer-dot" /><span>Built by students, for students.</span><span className="footer-spacer" /><span>Made with intent <Sparkles size={14} /></span></footer>
      {notice && <button className="toast" onClick={() => setNotice('')}>{notice}<X size={14} /></button>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSuccess={handleAuthSuccess} />}
      {adminOpen && signedIn && <AddNoteModal onClose={() => setAdminOpen(false)} onSubmit={handleCreateNote} />}
    </div>
  )
}

function Home({ onExplore, onSignIn, signedIn }) {
  return <>
    <section className="hero page-width">
      <div className="hero-copy reveal"><div className="eyebrow"><span className="live-dot" /> The student knowledge room</div><h1>Make your<br /><em>next chapter</em><br />count.</h1><p>Notes, people and momentum for the ones building what comes next. A calmer way to study together.</p><div className="hero-actions"><button className="button button-dark" onClick={onSignIn}>Sign in or sign up <ArrowUpRight size={17} /></button></div><div className="hero-proof"><div className="avatar-stack"><span className="avatar coral">AM</span><span className="avatar blue">MI</span><span className="avatar yellow">KS</span><span className="avatar green">+8k</span></div><span><strong>8,240+</strong> learners are in the room</span></div></div>
      <div className="hero-art reveal delay-one"><div className="art-grid" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-note note-main"><div className="note-top"><span className="mini-file coral-bg"><FileText size={16} /></span><span>DSA / 03</span><span className="note-status">fresh</span></div><h3>Patterns over<br />memorizing.</h3><div className="note-lines"><span /><span /><span /></div><div className="note-foot"><span>By Meera Iyer</span><ArrowUpRight size={16} /></div></div><div className="hero-note note-float"><Sparkles size={16} /><span>New notes<br /><b>every week</b></span></div><div className="scribble">learn<br /><span>loudly.</span></div></div>
    </section>
    <section className="signal-strip"><div className="page-width signal-inner"><div><span className="signal-number">01</span><span><b>One focused place</b><small>for your academic life</small></span></div><div><span className="signal-number">02</span><span><b>Real notes, real people</b><small>no noise, no endless feeds</small></span></div><div><span className="signal-number">03</span><span><b>Made to move with you</b><small>from first year to first job</small></span></div></div></section>
    <section className="preview-section page-width"><div className="section-heading"><div><span className="eyebrow">Private student room</span><h2>Notes worth<br /><i>keeping close.</i></h2></div><button className="round-arrow" onClick={onExplore}><ArrowUpRight size={21} /></button></div><div className="locked-library"><LockKeyhole size={24} /><div><h3>{signedIn ? 'Your library is ready.' : 'Sign in to unlock the library.'}</h3><p>Only signed-in members can view notes and Drive links. Everyone who is signed in can contribute.</p></div></div></section>
  </>
}

function NotesView({ subject, setSubject, search, setSearch, notes, folders, studentYear, connectionError, onRetry, onNoteAccess }) {
  const studentFolders = folders
  const availableSubjects = ['All notes', ...new Set(studentFolders.map((folder) => folder.subject))]
  const selectedFolder = studentFolders.find((folder) => folder.subject === subject)
  const visibleNotes = notes.filter((note) => (subject === 'All notes' || (selectedFolder && (note.folderId ? note.folderId === selectedFolder.id : note.subject === subject))) && `${note.title} ${note.subject}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="page-width app-page"><div className="view-heading"><div><span className="eyebrow">The library / 01</span><h1>Find your<br /><i>unfair advantage.</i></h1></div><span className="year-badge">{studentYear || 'All years'} subject room</span></div>{connectionError && <div className="connection-banner" role="alert"><span><strong>Connection interrupted</strong>{connectionError}</span><button className="button button-dark" onClick={onRetry}>Try again</button></div>}<div className="upload-rule"><UploadCloud size={18} /><span>Folders and subjects are organized by your year. Share a note through the public drop at the bottom of this page.</span></div><div className="toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes, subjects..." /></div><div className="subject-tabs">{availableSubjects.length > 1 ? availableSubjects.map((item) => <button className={subject === item ? 'subject-tab selected' : 'subject-tab'} key={item} onClick={() => setSubject(item)}>{item}</button>) : <span className="panel-caption">No subject folders yet for this year.</span>}</div></div><div className="notes-list">{visibleNotes.map((note) => <NoteCard key={note.id || note.title} note={note} list onAccess={onNoteAccess} />)}{visibleNotes.length === 0 && <div className="empty-state">No approved notes match that search yet.</div>}</div></section>
}

function UploadCta() {
  return <section className="upload-cta"><div className="upload-cta-grid" /><div className="upload-cta-copy"><span className="eyebrow">Open drop / 04</span><h2>Have something<br /><i>worth sharing?</i></h2><p>Drop a useful note for the next person figuring it out. No account. No OTP. Just your link.</p></div><a className="upload-cta-button" href={uploadLink} target="_blank" rel="noreferrer"><span className="upload-button-icon"><UploadCloud size={25} /></span><span><small>Anyone can upload</small><b>Send a note <ArrowUpRight size={17} /></b></span></a><span className="upload-stamp">PLAYBOOK<br /><b>DROP</b></span></section>
}

function NoteCard({ note, featured = false, list = false, onAccess }) {
  return <article className={`note-card ${featured ? 'featured' : ''} ${list ? 'list-card' : ''}`}>
    <div className={`file-icon ${note.color || 'blue'}`}><FileText size={24} /><span>{note.type || 'LINK'}</span></div>
    <div className="note-card-body">
      <div className="card-kicker">{note.subject} <span>·</span> {note.pages || 'Drive link'}</div>
      <h3>{note.title}</h3>
      <div className="card-meta">
        <span>By {note.author}</span>
        <a className="card-action" href={note.driveLink || '#'} target="_blank" rel="noreferrer" onClick={() => onAccess?.(note)}><Download size={15} /> Open Drive</a>
      </div>
    </div>
  </article>
}

function StudentsView({ onProfile }) {
  return <section className="page-width app-page"><div className="view-heading"><div><span className="eyebrow">The room / 02</span><h1>People who<br /><i>get it.</i></h1></div><div className="student-count"><strong>8,240</strong><span>members<br />and growing</span></div></div><div className="student-grid">{students.map((student) => <article className="student-card" key={student.name}><div className={`student-avatar ${student.color}`}>{student.initials}</div><div className="student-card-head"><span className="status-pill"><span className="live-dot" /> active now</span><button className="more-button">•••</button></div><h3>{student.name}</h3><p>{student.branch} · {student.year}</p><div className="student-bottom"><span>Contribution score <b>{student.score}</b></span><button className="edit-link" onClick={onProfile}>View profile <ArrowUpRight size={14} /></button></div></article>)}</div></section>
}

function ProfileView({ user, onSave, onBack }) {
  const [profile, setProfile] = useState({
    name: user?.name || '',
    college: user?.college || '',
    year: user?.year || '',
    branch: user?.branch || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const updateField = (field) => (event) => setProfile((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    if ([profile.name, profile.college, profile.year, profile.branch].some((value) => !value.trim())) {
      setError('Complete every profile field before saving.')
      return
    }
    setSaving(true)
    setError('')
    try { await onSave(profile) } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  const submitPasswordChange = async (event) => {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword.length < 8) { setPasswordError('Use at least 8 characters for the new password.'); return }
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return }
    setChangingPassword(true)
    try {
      await changePassword(currentPassword, newPassword, JSON.parse(localStorage.getItem('tech-titan-session') || 'null')?.token)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed successfully.')
    } catch (changeError) { setPasswordError(changeError.message) } finally { setChangingPassword(false) }
  }

  return <section className="page-width app-page profile-page">
    <div className="profile-banner">
      <div className="profile-avatar">{user?.name?.slice(0, 2).toUpperCase() || 'TT'}</div>
      <div><span className="eyebrow">Your account</span><h1>{user?.name || 'Profile'}</h1><p>{[user?.branch, user?.year].filter(Boolean).join(' · ')}</p></div>
      <button className="button button-light" onClick={onBack}><ArrowUpRight size={15} /> Back to the room</button>
    </div>
    <div className="profile-columns">
      <form className="profile-panel" onSubmit={submit}>
        <div className="panel-title"><span>Edit your details</span><Settings2 size={17} /></div>
        <label>Email<input type="email" value={user?.email || ''} readOnly /></label>
        <label>Full name<input value={profile.name} onChange={updateField('name')} required /></label>
        <label>College<input value={profile.college} onChange={updateField('college')} required /></label>
        <div className="two-fields">
          <label>Year<input value={profile.year} onChange={updateField('year')} required /></label>
          <label>Branch<input value={profile.branch} onChange={updateField('branch')} required /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'} <Check size={16} /></button>
      </form>
      <form className="profile-panel" onSubmit={submitPasswordChange}>
        <div className="panel-title"><span>Change password</span><LockKeyhole size={17} /></div>
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required /></label>
        {passwordError && <p className="form-error">{passwordError}</p>}
        {passwordMessage && <p className="form-success">{passwordMessage}</p>}
        <button className="button button-dark" type="submit" disabled={changingPassword}>{changingPassword ? 'Updating…' : 'Change password'} <Check size={16} /></button>
      </form>
    </div>
  </section>
}

function LegacyAdminView({ users, notes, folders, token, onCreateFolder, onCreateNote, onNoteStatus, onBlock, onDelete, onEditFolder, onDeleteFolder, onEditNote, onDeleteNote }) {
  return <section className="page-width app-page"><div className="view-heading"><div><span className="eyebrow">Admin only / 03</span><h1>Keep the room<br /><i>in motion.</i></h1></div><a className="button button-dark" href={`http://localhost:5000/api/admin/users/export?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer"><Download size={17} /> Export users</a></div><div className="admin-grid"><div className="admin-stat-card dark"><span>Total users</span><strong>{users.length}</strong><small>Firestore records</small></div><div className="admin-stat-card cream"><span>Subject folders</span><strong>{folders.length}</strong><small>Year-wise library map</small></div><div className="admin-stat-card yellow-card"><span>Review queue</span><strong>{notes.filter((note) => note.status === 'pending').length}</strong><small>Notes awaiting approval</small></div></div><div className="admin-workspace"><div className="admin-panel"><div className="panel-title"><span>Create subject folder</span><GraduationCap size={17} /></div><p className="panel-help">Every folder appears as a subject tab for students in its selected year.</p><FolderForm onSubmit={onCreateFolder} /></div><div className="admin-panel"><div className="panel-title"><span>Publish a note</span><UploadCloud size={17} /></div><p className="panel-help">Attach the note to a year and folder so it lands in the right student room.</p><AdminNoteForm folders={folders} onSubmit={onCreateNote} /></div></div><div className="admin-table"><div className="table-title"><div><span className="eyebrow">Content queue</span><h2>Notes</h2></div><span className="panel-caption">Approve or reject student submissions</span></div>{notes.length === 0 && <div className="empty-state">No notes have been submitted yet.</div>}{notes.map((note) => <div className="table-row" key={note.id}><span className={`file-dot ${note.status === 'approved' ? 'green' : 'yellow'}`}><FileText size={16} /></span><span className="row-name"><b>{note.title}</b><small>{note.year} · {note.subject} · {note.author}</small></span><span className={note.status === 'approved' ? 'review-pill' : 'review-pill pending-pill'}>{note.status}</span>{note.status === 'pending' && <><button className="button compact-button" onClick={() => onNoteStatus(note.id, 'approved')}>Approve</button><button className="button compact-button danger-button" onClick={() => onNoteStatus(note.id, 'rejected')}>Reject</button></>}</div>)}</div><div className="admin-table"><div className="table-title"><div><span className="eyebrow">Access management</span><h2>Users</h2></div><span className="panel-caption">Only admins can see this area</span></div>{users.map((user) => <div className="table-row" key={user.id}><span className="file-dot blue"><Users size={16} /></span><span className="row-name"><b>{user.name || 'Unnamed student'}</b><small>{user.email} · {user.role}</small></span><span className={user.blocked ? 'review-pill blocked-pill' : 'review-pill'}>{user.blocked ? 'Blocked' : 'Active'}</span><button className="button compact-button" onClick={() => onBlock(user.id, !user.blocked)}>{user.blocked ? 'Unblock' : 'Block'}</button><button className="button compact-button danger-button" onClick={() => { if (window.confirm(`Delete ${user.name || user.email}?`)) onDelete(user.id) }}>Delete</button></div>)}</div></section>
  return <section className="page-width app-page">
    <div className="view-heading">
      <div><span className="eyebrow">Admin only / 03</span><h1>Keep the room<br /><i>in motion.</i></h1></div>
      <a className="button button-dark" href={getExportUrl(token)} target="_blank" rel="noreferrer"><Download size={17} /> Export workbook</a>
    </div>
    <div className="admin-grid">
      <div className="admin-stat-card dark"><span>Total users</span><strong>{users.length}</strong><small>Firestore records</small></div>
      <div className="admin-stat-card cream"><span>Subject folders</span><strong>{folders.length}</strong><small>Year-wise library map</small></div>
      <div className="admin-stat-card yellow-card"><span>Review queue</span><strong>{notes.filter((note) => note.status === 'pending').length}</strong><small>Notes awaiting admin review</small></div>
    </div>
    <div className="admin-workspace">
      <div className="admin-panel"><div className="panel-title"><span>Create subject folder</span><GraduationCap size={17} /></div><p className="panel-help">Every folder appears as a subject tab for students in its selected year.</p><FolderForm onSubmit={onCreateFolder} /></div>
      <div className="admin-panel"><div className="panel-title"><span>Publish a note</span><UploadCloud size={17} /></div><p className="panel-help">Attach the note to a year and folder so it lands in the right student room.</p><AdminNoteForm folders={folders} onSubmit={onCreateNote} /></div>
    </div>
    <AdminManageContent folders={folders} notes={notes} onEditFolder={onEditFolder} onDeleteFolder={onDeleteFolder} onEditNote={onEditNote} onDeleteNote={onDeleteNote} />
    <div className="admin-table">
      <div className="table-title"><div><span className="eyebrow">Content queue</span><h2>Notes</h2></div><span className="panel-caption">Approve or reject student submissions</span></div>
      {notes.length === 0 && <div className="empty-state">No notes have been submitted yet.</div>}
      {notes.map((note) => <div className="table-row" key={note.id}>
        <span className={`file-dot ${note.status === 'approved' ? 'green' : 'yellow'}`}><FileText size={16} /></span>
        <span className="row-name"><b>{note.title}</b><small>{note.year} · {note.subject} · {note.author}</small></span>
        <span className={note.status === 'approved' ? 'review-pill' : 'review-pill pending-pill'}>{note.status}</span>
        {note.status === 'pending' && <><button className="button compact-button" onClick={() => onNoteStatus(note.id, 'approved')}>Approve</button><button className="button compact-button danger-button" onClick={() => onNoteStatus(note.id, 'rejected')}>Reject</button></>}
      </div>)}
    </div>
    <div className="admin-table">
      <div className="table-title"><div><span className="eyebrow">Access management</span><h2>Users</h2></div><span className="panel-caption">Only admins can see this area</span></div>
      {users.map((user) => <div className="table-row" key={user.id}>
        <span className="file-dot blue"><Users size={16} /></span>
        <span className="row-name"><b>{user.name || 'Unnamed student'}</b><small>{user.email} · {user.role}</small></span>
        <span className={user.blocked ? 'review-pill blocked-pill' : 'review-pill'}>{user.blocked ? 'Blocked' : 'Active'}</span>
        <button className="button compact-button" onClick={() => onBlock(user.id, !user.blocked)}>{user.blocked ? 'Unblock' : 'Block'}</button>
        <button className="button compact-button danger-button" onClick={() => { if (window.confirm(`Delete ${user.name || user.email}?`)) onDelete(user.id) }}>Delete</button>
      </div>)}
    </div>
  </section>
}

function AdminView({ users, notes, folders, token, onCreateFolder, onCreateNote, onNoteStatus, onBlock, onDelete, onEditFolder, onDeleteFolder, onEditNote, onDeleteNote, onUpdateUser }) {
  const [userFilter, setUserFilter] = useState('')
  const [showAllUsers, setShowAllUsers] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const filteredUsers = users.filter((user) => userMatchesQuery(user, userFilter))
  const visibleUsers = showAllUsers ? filteredUsers : filteredUsers.slice(0, 5)

  return <section className="page-width app-page">
    <div className="view-heading"><div><span className="eyebrow">Admin only / 03</span><h1>Keep the room<br /><i>in motion.</i></h1></div><a className="button button-dark" href={getExportUrl(token)} target="_blank" rel="noreferrer"><Download size={17} /> Export workbook</a></div>
    <div className="admin-grid">
      <div className="admin-stat-card dark"><span>Total users</span><strong>{users.length}</strong><small>Firestore records</small></div>
      <div className="admin-stat-card cream"><span>Subject folders</span><strong>{folders.length}</strong><small>Year-wise library map</small></div>
      <div className="admin-stat-card yellow-card"><span>Review queue</span><strong>{notes.filter((note) => note.status === 'pending').length}</strong><small>Notes awaiting admin review</small></div>
    </div>
    <div className="admin-workspace">
      <div className="admin-panel"><div className="panel-title"><span>Create subject folder</span><GraduationCap size={17} /></div><p className="panel-help">Every folder appears as a subject tab for students in its selected year.</p><FolderForm onSubmit={onCreateFolder} /></div>
      <div className="admin-panel"><div className="panel-title"><span>Publish a note</span><UploadCloud size={17} /></div><p className="panel-help">Attach the note to a year and folder so it lands in the right student room.</p><AdminNoteForm folders={folders} onSubmit={onCreateNote} /></div>
    </div>
    <AdminManageContent folders={folders} notes={notes} onEditFolder={onEditFolder} onDeleteFolder={onDeleteFolder} onEditNote={onEditNote} onDeleteNote={onDeleteNote} />
    <div className="admin-table">
      <div className="table-title"><div><span className="eyebrow">Content queue</span><h2>Notes</h2></div><span className="panel-caption">Approve or reject student submissions</span></div>
      {notes.length === 0 && <div className="empty-state">No notes have been submitted yet.</div>}
      {notes.map((note) => <div className="table-row" key={note.id}>
        <span className={`file-dot ${note.status === 'approved' ? 'green' : 'yellow'}`}><FileText size={16} /></span><span className="row-name"><b>{note.title}</b><small>{note.year} · {note.subject} · {note.author}</small></span><span className={note.status === 'approved' ? 'review-pill' : 'review-pill pending-pill'}>{note.status}</span>
        {note.status === 'pending' && <><button className="button compact-button" onClick={() => onNoteStatus(note.id, 'approved')}>Approve</button><button className="button compact-button danger-button" onClick={() => onNoteStatus(note.id, 'rejected')}>Reject</button></>}
      </div>)}
    </div>
    <div className="admin-table">
      <div className="table-title"><div><span className="eyebrow">Access management</span><h2>Users</h2></div><span className="panel-caption">Only full admins can see this area</span></div>
      <div className="search-box"><Search size={17} /><input type="search" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="Find by name, email, college, year, branch, or role" /></div>
      {visibleUsers.map((user) => <div className="table-row user-access-row" key={user.id}>
        <span className="file-dot blue"><Users size={16} /></span><span className="row-name"><b>{user.name || 'Unnamed student'}</b><small>{user.email} · {user.role}</small></span><span className={user.blocked ? 'review-pill blocked-pill' : 'review-pill'}>{user.blocked ? 'Blocked' : 'Active'}</span>
        <div className="user-row-actions"><button className="button compact-button" onClick={() => setSelectedUser(user)}>Details / edit</button><button className="button compact-button" onClick={() => onBlock(user.id, !user.blocked)}>{user.blocked ? 'Unblock' : 'Block'}</button><button className="button compact-button danger-button" onClick={() => { if (window.confirm(`Delete ${user.name || user.email}?`)) onDelete(user.id) }}>Delete</button></div>
      </div>)}
      {filteredUsers.length === 0 && <div className="empty-state">No users match this search.</div>}
      {filteredUsers.length > 5 && <button className="list-toggle" onClick={() => setShowAllUsers((shown) => !shown)}>{showAllUsers ? 'Show fewer users' : `Show all ${filteredUsers.length} users`} <ChevronDown size={15} className={showAllUsers ? 'list-toggle-open' : ''} /></button>}
    </div>
    {selectedUser && <AdminUserDetailsModal user={selectedUser} token={token} onClose={() => setSelectedUser(null)} onSave={onUpdateUser} />}
  </section>
}

function AdminUserDetailsModal({ user, token, onClose, onSave }) {
  const [profile, setProfile] = useState({ name: user.name || '', college: user.college || '', year: user.year || '', branch: user.branch || '' })
  const [registeredAt, setRegisteredAt] = useState(user.registeredAt || '')
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAdminUserDetails(user.id, token).then((details) => {
      if (!active) return
      setProfile({ name: details.user.name || '', college: details.user.college || '', year: details.user.year || '', branch: details.user.branch || '' })
      setRegisteredAt(details.user.registeredAt || '')
      setActivity(details.activity)
    }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id, token])

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const updated = await onSave(user.id, profile)
      setProfile({ name: updated.name, college: updated.college, year: updated.year, branch: updated.branch })
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="auth-modal user-details-modal" role="dialog" aria-modal="true" aria-labelledby="user-details-title">
      <button className="modal-close" onClick={onClose} aria-label="Close user details"><X size={18} /></button>
      <span className="eyebrow">Access management</span>
      <h2 id="user-details-title">User details</h2>
      <p className="modal-copy">{user.email} · {registeredAt ? `Registered ${new Date(registeredAt).toLocaleString()}` : 'Registration date unavailable'}</p>
      <form className="user-detail-form" onSubmit={submit}>
        <label className="modal-label">Full name<input required maxLength={120} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
        <label className="modal-label">College<input required maxLength={200} value={profile.college} onChange={(event) => setProfile({ ...profile, college: event.target.value })} /></label>
        <label className="modal-label">Year<input required maxLength={80} value={profile.year} onChange={(event) => setProfile({ ...profile, year: event.target.value })} /></label>
        <label className="modal-label">Branch<input required maxLength={120} value={profile.branch} onChange={(event) => setProfile({ ...profile, branch: event.target.value })} /></label>
        {error && <p className="form-error user-detail-error">{error}</p>}
        <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'} <Check size={16} /></button>
      </form>
      <div className="user-activity">
        <div className="panel-title"><span>Account activity</span><Clock3 size={17} /></div>
        <p className="panel-help">Registration, sign-in, sign-out, and opened notes. IP addresses are visible only to admins.</p>
        {loading ? <div className="empty-state">Loading activity…</div> : activity.length ? <div className="user-activity-list">{activity.map((item) => <article className="user-activity-row" key={item.id}>
          <div><b>{item.event === 'note_access' ? 'Opened note' : item.event.replaceAll('_', ' ')}</b><small>{item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Time unavailable'}</small></div>
          <span className="activity-ip">{item.ipAddress || 'IP unavailable'}</span>
          {item.noteTitle && <small className="activity-note">{item.noteTitle}{item.subject ? ` · ${item.subject}` : ''}</small>}
        </article>)}</div> : <div className="empty-state">No activity recorded yet. Tracking starts with the next account event.</div>}
      </div>
    </section>
  </div>
}

function ContentAdminManager({ users, onSetRole }) {
  const [userFilter, setUserFilter] = useState('')
  const eligibleUsers = users.filter((user) => user.role !== 'admin' && userMatchesQuery(user, userFilter))
  return <section className="page-width app-page">
    <div className="admin-panel">
      <div className="panel-title"><span>Note manager access</span><ShieldCheck size={17} /></div>
      <p className="panel-help">Grant note upload and editing access without user, folder, or export controls.</p>
      <div className="search-box"><Search size={17} /><input type="search" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="Find user by name, email, college, year, branch, or role" /></div>
      {eligibleUsers.map((user) => <div className="manage-row" key={user.id}>
        <span><b>{user.name || 'Unnamed user'}</b><small>{user.email} · {user.role}</small></span>
        <button className="button compact-button" disabled={user.blocked} onClick={() => onSetRole(user.id, user.role === 'content_admin' ? 'student' : 'content_admin')}>
          {user.role === 'content_admin' ? 'Remove access' : 'Grant access'}
        </button>
      </div>)}
      {eligibleUsers.length === 0 && <div className="empty-state">No users match this search.</div>}
    </div>
  </section>
}

function ContentAdminView({ folders, notes, onCreateNote, onEditNote, onDeleteNote }) {
  return <section className="page-width app-page content-admin-view">
    <div className="view-heading"><div><span className="eyebrow">Content admin / 03</span><h1>Manage the<br /><i>notes room.</i></h1></div></div>
    <div className="admin-workspace"><div className="admin-panel">
      <div className="panel-title"><span>Publish a note</span><UploadCloud size={17} /></div>
      <p className="panel-help">Upload notes to an existing year and subject folder.</p>
      <AdminNoteForm folders={folders} onSubmit={onCreateNote} />
    </div></div>
    <AdminManageContent folders={[]} notes={notes} onEditNote={onEditNote} onDeleteNote={onDeleteNote} />
  </section>
}

function FolderForm({ onSubmit }) {
  const [folder, setFolder] = useState({ subject: '', year: years[0] })
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); onSubmit(folder); setFolder({ ...folder, subject: '' }) }}><label className="modal-label">Subject name<input required value={folder.subject} onChange={(event) => setFolder({ ...folder, subject: event.target.value })} placeholder="e.g. Data Structures" /></label><label className="modal-label">Student year<select value={folder.year} onChange={(event) => setFolder({ ...folder, year: event.target.value })}>{years.map((year) => <option key={year}>{year}</option>)}</select></label><button className="button button-dark full" type="submit"><Plus size={16} /> Add subject folder</button></form>
}

function AdminNoteForm({ folders, onSubmit }) {
  const [note, setNote] = useState({ title: '', folderId: '', driveLink: '' })
  const selectedFolder = folders.find((folder) => folder.id === note.folderId)
  const canPublish = Boolean(note.title.trim() && selectedFolder && note.driveLink.trim())
  const submit = async (event) => {
    event.preventDefault()
    if (!selectedFolder) return
    const saved = await onSubmit({ ...note, year: selectedFolder.year, subject: selectedFolder.subject })
    if (saved) setNote({ title: '', folderId: '', driveLink: '' })
  }

  return <form className="admin-form" onSubmit={submit}>
    <label className="modal-label">Note title<input required value={note.title} onChange={(event) => setNote({ ...note, title: event.target.value })} placeholder="e.g. Graph algorithms" /></label>
    <label className="modal-label">Subject folder<select required value={note.folderId} onChange={(event) => setNote({ ...note, folderId: event.target.value })} disabled={folders.length === 0}>
      <option value="">{folders.length ? 'Choose folder' : 'Create a folder first'}</option>
      {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.subject} · {folder.year}</option>)}
    </select></label>
    <label className="modal-label">Drive link<input required type="url" value={note.driveLink} onChange={(event) => setNote({ ...note, driveLink: event.target.value })} placeholder="Paste a Google Drive link" /></label>
    <button className="button button-dark full" type="submit" disabled={!canPublish}><UploadCloud size={16} /> Publish note</button>
  </form>
}

function AdminManageContent({ folders, notes, onEditFolder, onDeleteFolder, onEditNote, onDeleteNote }) {
  const session = JSON.parse(localStorage.getItem('tech-titan-session') || 'null')
  const isAdmin = session?.user?.role === 'admin'
  const [editingNote, setEditingNote] = useState(null)
  const [folderSearch, setFolderSearch] = useState('')
  const [noteSearch, setNoteSearch] = useState('')
  const [showAllFolders, setShowAllFolders] = useState(false)
  const [showAllNotes, setShowAllNotes] = useState(false)
  const normalizedFolderSearch = folderSearch.trim().toLowerCase()
  const normalizedNoteSearch = noteSearch.trim().toLowerCase()
  const filteredFolders = folders.filter((folder) => `${folder.subject} ${folder.year}`.toLowerCase().includes(normalizedFolderSearch))
  const filteredNotes = notes.filter((note) => `${note.title} ${note.subject} ${note.year} ${note.author} ${note.status}`.toLowerCase().includes(normalizedNoteSearch))
  const visibleFolders = showAllFolders ? filteredFolders : filteredFolders.slice(0, 5)
  const visibleNotes = showAllNotes ? filteredNotes : filteredNotes.slice(0, 5)
  return <div className="admin-workspace">
    {isAdmin && <section className="admin-panel"><div className="panel-title"><span>Manage folders</span><GraduationCap size={17} /></div>
      <div className="search-box management-search"><Search size={16} /><input type="search" value={folderSearch} onChange={(event) => setFolderSearch(event.target.value)} placeholder="Search folders by subject or year" /></div>
      {visibleFolders.map((folder) => <div className="manage-row" key={folder.id}><span><b>{folder.subject}</b><small>{folder.year}</small></span><button className="button compact-button" onClick={() => onEditFolder(folder)}>Edit</button><button className="button compact-button danger-button" onClick={() => onDeleteFolder(folder)}>Delete</button></div>)}
      {filteredFolders.length === 0 && <div className="empty-state">{folders.length ? 'No folders match this search.' : 'No subject folders yet.'}</div>}
      {filteredFolders.length > 5 && <button className="list-toggle" onClick={() => setShowAllFolders((shown) => !shown)}>{showAllFolders ? 'Show fewer folders' : `Show all ${filteredFolders.length} folders`} <ChevronDown size={15} className={showAllFolders ? 'list-toggle-open' : ''} /></button>}
    </section>}
    <section className="admin-panel"><div className="panel-title"><span>Manage published content</span><Settings2 size={17} /></div>
      <div className="search-box management-search"><Search size={16} /><input type="search" value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} placeholder="Search notes by title, subject, or status" /></div>
      {visibleNotes.map((note) => <div className="manage-row" key={note.id}><span><b>{note.title}</b><small>{note.year} · {note.subject} · {note.status}</small></span><button className="button compact-button" onClick={() => setEditingNote(note)}>Edit</button><button className="button compact-button danger-button" onClick={() => onDeleteNote(note)}>Delete</button></div>)}
      {filteredNotes.length === 0 && <div className="empty-state">{notes.length ? 'No notes match this search.' : 'No published or submitted notes yet.'}</div>}
      {filteredNotes.length > 5 && <button className="list-toggle" onClick={() => setShowAllNotes((shown) => !shown)}>{showAllNotes ? 'Show fewer notes' : `Show all ${filteredNotes.length} notes`} <ChevronDown size={15} className={showAllNotes ? 'list-toggle-open' : ''} /></button>}
    </section>
    {editingNote && <EditPublishedNoteModal note={editingNote} folders={folders} canChangeFolder={isAdmin} onClose={() => setEditingNote(null)} onSave={onEditNote} />}
  </div>
}

function AuthModal({ onClose, onSuccess }) {
  const [step, setStep] = useState('form')
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '')
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [college, setCollege] = useState('')
  const [year, setYear] = useState('')
  const [branch, setBranch] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submitSignIn = async () => {
    if (!gmailPattern.test(email)) { setError('Use a valid Gmail address ending with @gmail.com.'); return }
    try { onSuccess(await signIn(email, password)) } catch (requestError) { setError(requestError.message) }
  }
  const validateSignup = () => {
    if ([name, college, year, branch, email, password].some((value) => !value.trim())) {
      setError('Complete every signup field.')
      return false
    }
    if (!gmailPattern.test(email)) { setError('Use a valid Gmail address ending with @gmail.com.'); return false }
    if (password.length < 8) { setError('A password of at least 8 characters is required.'); return false }
    return true
  }
  const submitSignup = async () => {
    if (!validateSignup()) return
    try { onSuccess(await verifySignupCode(email, code, password, name, college, year, branch)) } catch (requestError) { setError(requestError.message) }
  }
  const sendSignupCode = async () => {
    if (!validateSignup()) return
    try {
      await requestSignupCode(email.trim())
      setStep('otp')
      setError('')
      setMessage(`Verification code sent to ${email.trim()}. Check your spam folder if it isn't in your inbox.`)
    } catch (requestError) { setError(requestError.message) }
  }
  const sendReset = async () => {
    try { const result = await forgotPassword(email); setMessage(result.message); setError('') } catch (requestError) { setError(requestError.message) }
  }
  const submitReset = async () => {
    try { await resetPassword(resetToken, password); setMode('signin'); setMessage('Password updated. Sign in with your new password.'); setError('') } catch (requestError) { setError(requestError.message) }
  }
  const changeMode = (nextMode) => { setMode(nextMode); setStep('form'); setError(''); setMessage(''); setCode('') }

  return <div className="modal-backdrop"><div className="auth-modal"><button className="modal-close" onClick={onClose}><X size={18} /></button><div className="auth-symbol"><LockKeyhole size={20} /></div>{mode !== 'reset' && <div className="auth-switch"><button className={mode === 'signin' ? 'selected' : ''} onClick={() => changeMode('signin')}>Sign in</button><button className={mode === 'signup' ? 'selected' : ''} onClick={() => changeMode('signup')}>Sign up</button><button className={mode === 'forgot' ? 'selected' : ''} onClick={() => changeMode('forgot')}>Forgot password</button></div>}{mode === 'forgot' ? <><span className="eyebrow">Reset access</span><h2>Find your<br /><i>way back.</i></h2><p className="modal-copy">Enter your email and we’ll send a reset link.</p><label className="modal-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" /></label><button className="button button-dark full" onClick={sendReset} disabled={!email}>Send reset link <Mail size={16} /></button></> : mode === 'reset' ? <><span className="eyebrow">New password</span><h2>Set a fresh<br /><i>start.</i></h2><label className="modal-label">New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><button className="button button-dark full" onClick={submitReset} disabled={password.length < 8}>Update password <ArrowUpRight size={16} /></button></> : mode === 'signup' && step === 'otp' ? <><span className="eyebrow">Verify signup</span><h2>One last<br /><i>step.</i></h2><p className="modal-copy">Enter the code sent to {email} to finish creating your account.</p><label className="modal-label">Signup OTP<input className="otp-input" inputMode="numeric" maxLength="6" value={code} onChange={(event) => setCode(event.target.value)} placeholder="• • •  • • •" /></label><button className="button button-dark full" onClick={submitSignup} disabled={code.length !== 6}>Verify & create account <ArrowUpRight size={16} /></button></> : <><span className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Create account'}</span><h2>{mode === 'signin' ? <>Sign in to your<br /><i>space.</i></> : <>Sign up for your<br /><i>space.</i></>}</h2><p className="modal-copy">{mode === 'signin' ? 'Sign in with your email and password.' : 'Signup requires one email verification code. Sign in does not.'}</p>{mode === 'signup' && <><label className="modal-label">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label><label className="modal-label">College<input value={college} onChange={(event) => setCollege(event.target.value)} placeholder="Your college" /></label><div className="two-fields"><label className="modal-label">Year<input value={year} onChange={(event) => setYear(event.target.value)} placeholder="3rd year" /></label><label className="modal-label">Branch<input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Computer Science" /></label></div></>}<label className="modal-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" /></label><label className="modal-label">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><button className="button button-dark full" onClick={mode === 'signup' ? sendSignupCode : submitSignIn} disabled={!email || password.length < 8}>{mode === 'signup' ? 'Send signup OTP' : 'Sign in'} <ArrowUpRight size={16} /></button></>}{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}</div></div>
}

function LegacyAuthModal({ onClose, onSuccess }) {
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '')
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submit = async () => {
    try {
      const result = mode === 'signup' ? await signUp(email, password, name) : await signIn(email, password)
      onSuccess(result)
    } catch (requestError) { setError(requestError.message) }
  }
  const sendReset = async () => {
    try { const result = await forgotPassword(email); setMessage(result.message); setError('') } catch (requestError) { setError(requestError.message) }
  }
  const submitReset = async () => { try { await resetPassword(resetToken, password); setMode('signin'); setMessage('Password updated. Sign in with your new password.'); setError('') } catch (requestError) { setError(requestError.message) } }
  return <div className="modal-backdrop"><div className="auth-modal"><button className="modal-close" onClick={onClose}><X size={18} /></button><div className="auth-symbol"><LockKeyhole size={20} /></div>{mode !== 'reset' && <div className="auth-switch"><button className={mode === 'signin' ? 'selected' : ''} onClick={() => { setMode('signin'); setMessage('') }}>Sign in</button><button className={mode === 'signup' ? 'selected' : ''} onClick={() => { setMode('signup'); setMessage('') }}>Sign up</button><button className={mode === 'forgot' ? 'selected' : ''} onClick={() => setMode('forgot')}>Forgot password</button></div>}{mode === 'forgot' ? <><span className="eyebrow">Reset access</span><h2>Find your<br /><i>way back.</i></h2><p className="modal-copy">Enter your account email and we’ll create a reset link.</p><label className="modal-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" /></label><button className="button button-dark full" onClick={sendReset} disabled={!email}>Send reset link <Mail size={16} /></button></> : mode === 'reset' ? <><span className="eyebrow">New password</span><h2>Set a fresh<br /><i>start.</i></h2><label className="modal-label">New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><button className="button button-dark full" onClick={submitReset} disabled={password.length < 8}>Update password <ArrowUpRight size={16} /></button></> : <><span className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Join the room'}</span><h2>{mode === 'signin' ? <>Sign in to your<br /><i>space.</i></> : <>Create your<br /><i>space.</i></>}</h2><p className="modal-copy">Use your email and password to access the student room.</p>{mode === 'signup' && <label className="modal-label">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>}<label className="modal-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" /></label><label className="modal-label">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><button className="button button-dark full" onClick={submit} disabled={!email || password.length < 8}>{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowUpRight size={16} /></button></>}{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}</div></div>
}

function AddNoteModal({ onClose, onSubmit }) {
  const [note, setNote] = useState({ title: '', subject: 'Data Structures', driveLink: '' })
  return <div className="modal-backdrop"><div className="auth-modal add-modal"><button className="modal-close" onClick={onClose}><X size={18} /></button><div className="auth-symbol upload-symbol"><UploadCloud size={20} /></div><span className="eyebrow">Share knowledge</span><h2>Add a new<br /><i>note.</i></h2><label className="modal-label">Note title<input value={note.title} onChange={(event) => setNote({ ...note, title: event.target.value })} placeholder="e.g. CN unit 3 cheat sheet" /></label><label className="modal-label">Subject<select value={note.subject} onChange={(event) => setNote({ ...note, subject: event.target.value })}><option>Data Structures</option><option>Database Systems</option><option>Operating Systems</option><option>Web Development</option></select></label><label className="modal-label">Drive link<input value={note.driveLink} onChange={(event) => setNote({ ...note, driveLink: event.target.value })} placeholder="Paste your Google Drive link" /></label><button className="button button-dark full" disabled={!note.title || !note.driveLink} onClick={() => onSubmit(note)}>Submit for review <ArrowUpRight size={16} /></button></div></div>
}

function EditPublishedNoteModal({ note, folders, canChangeFolder, onClose, onSave }) {
  const matchingFolder = folders.find((folder) => folder.id === note.folderId)
    || folders.find((folder) => folder.subject === note.subject && folder.year === note.year)
  const [title, setTitle] = useState(note.title || '')
  const [driveLink, setDriveLink] = useState(note.driveLink || '')
  const [folderId, setFolderId] = useState(matchingFolder?.id || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const folder = folders.find((item) => item.id === folderId)
    if (canChangeFolder && !folder) { setError('Choose a subject folder.'); return }
    setSaving(true)
    setError('')
    const changes = { id: note.id, title: title.trim(), driveLink: driveLink.trim() }
    if (canChangeFolder) Object.assign(changes, { folderId: folder.id, subject: folder.subject, year: folder.year })
    const saved = await onSave(changes)
    setSaving(false)
    if (saved) onClose()
    else setError('The note could not be saved. Please try again.')
  }

  return <div className="modal-backdrop"><form className="auth-modal add-modal" onSubmit={submit}>
    <button className="modal-close" type="button" onClick={onClose}><X size={18} /></button>
    <div className="auth-symbol upload-symbol"><Pencil size={20} /></div>
    <span className="eyebrow">Manage published content</span><h2>Edit this<br /><i>note.</i></h2>
    <label className="modal-label">Note title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="modal-label">Drive link<input required type="url" value={driveLink} onChange={(event) => setDriveLink(event.target.value)} /></label>
    {canChangeFolder && <label className="modal-label">Subject folder<select required value={folderId} onChange={(event) => setFolderId(event.target.value)}>
      <option value="">Choose folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.subject} · {folder.year}</option>)}
    </select></label>}
    {error && <p className="form-error">{error}</p>}
    <button className="button button-dark full" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'} <Check size={16} /></button>
  </form></div>
}

export default App
