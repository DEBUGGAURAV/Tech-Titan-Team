import React, { useEffect, useState, Suspense, lazy } from 'react'
import {
  ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, Download, FileText,
  GraduationCap, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, Pencil, Plus, Trash2,
  Search, Settings2, ShieldCheck, Sparkles, UploadCloud, Users, X, Zap, Bell,
} from 'lucide-react'
import {
  changePassword, createFolder, createNote, createNotice, deleteAdminUser,
  deleteAllAdminUsers, deleteFolder, deleteNote, deleteNotice, updateNotice, decideAdminRoleRequest,
  forgotPassword, getAdminNotes, getAdminRoleRequests, getAdminUserDetails,
  getAdminUsers, getFolders, getNotices,
  getNotes, recordLogout, recordNoteAccess, requestSignupCode, resetPassword,
  setUserBlocked, setUserPermissions, signIn, signUp, updateAdminUser,
  updateFolder, updateNote, updateProfile, verifySignupCode, downloadAdminExport,
} from './api'
const AuthModal = lazy(() => import('./components/AuthModal'))
const NotesView = lazy(() => import('./components/NotesView'))
const StudentsView = lazy(() => import('./components/StudentsView'))
import Sidebar from './components/Sidebar'
const ProfileView = lazy(() => import('./components/ProfileView'))
import NoticeBoard from './components/NoticeBoard'
const AdminView = lazy(() => import('./components/AdminView'))
import { AddNoteModal } from './components/UploadForms'
import { ContentAdminManager, ContentAdminView } from './components/ContentAdmin'
import UploadDocumentSpace from './components/UploadDocumentSpace'

const years = ['1st year', '2nd year', '3rd year', '4th year']
const subjects = ['Cloud Computing (CC)', 'Cryptography (CNS)', 'Artificial Intelligence (AI)', 'Deep Learning']
const uploadLink = 'https://www.playbook.com/techtitan/drop'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const notePermissionOptions = [
  { key: 'uploadNotes', label: 'Upload / publish notes' },
  { key: 'editNotes', label: 'Edit notes' },
  { key: 'deleteNotes', label: 'Delete notes' },
  { key: 'reviewNotes', label: 'Approve / reject submissions' },
]
const hasNotePermission = (user, permission) => user?.role === 'admin' || user?.role === 'content_admin' || user?.permissions?.[permission] === true
const hasAnyNotePermission = (user) => user?.role === 'admin' || user?.role === 'content_admin' || notePermissionOptions.some(({ key }) => user?.permissions?.[key] === true)
const isValidMobile = (value) => {
  const mobile = value.trim()
  const digitCount = (mobile.match(/\d/g) || []).length
  return mobile.length <= 20 && /^\+?[0-9][0-9\s().-]*$/.test(mobile) && digitCount >= 7 && digitCount <= 15
}
const userMatchesQuery = (user, query) => {
  const normalizedQuery = query.trim().toLowerCase()
  return !normalizedQuery || [user.name, user.email, user.mobile, user.college, user.year, user.branch, user.course, user.role]
    .some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
}


function App() {
  const [view, setView] = useState('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [subject, setSubject] = useState('All notes')
  const [search, setSearch] = useState('')
  const [authOpen, setAuthOpen] = useState(() => new URLSearchParams(window.location.search).get('signup') === '1')
  const [adminOpen, setAdminOpen] = useState(false)
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('tech-titan-session') || 'null'))
  const [liveNotes, setLiveNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tech-titan-notes-cache') || '[]'); } catch { return []; }
  })
  const [folders, setFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tech-titan-folders-cache') || '[]'); } catch { return []; }
  })
  const [adminUsers, setAdminUsers] = useState([])
  const [adminRoleRequests, setAdminRoleRequests] = useState([])
  const [canApproveAdminRequests, setCanApproveAdminRequests] = useState(false)
  const [adminNotes, setAdminNotes] = useState([])
  const [noticeBoard, setNoticeBoard] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tech-titan-notices-cache') || '[]'); } catch { return []; }
  })
  const [notice, setNotice] = useState('')
  const [newUploadCount, setNewUploadCount] = useState(0)
  const [connectionError, setConnectionError] = useState('')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const signedIn = Boolean(session?.token)
  const isAdmin = session?.user?.role === 'admin'
  const canManageContent = hasAnyNotePermission(session?.user)

  useEffect(() => {
    if (!session?.token) {
      setNoticeBoard([])
      setAdminRoleRequests([])
      setCanApproveAdminRequests(false)
      return
    }
    let active = true
    let initialized = false
    let knownNoteIds = new Set()
    const refreshNotes = () => {
      if (document.visibilityState !== 'visible') return
      getNotes(session.token).then((nextNotes) => {
      if (!active) return
      const newNotes = nextNotes.filter((note) => !knownNoteIds.has(note.id || note.title))
      if (initialized && newNotes.length) {
        setNewUploadCount(Math.min(newNotes.length, 8))
        setNotice(`${newNotes.length} new note${newNotes.length === 1 ? ' is' : 's are'} available.`)
      }
      knownNoteIds = new Set(nextNotes.map((note) => note.id || note.title))
      initialized = true
      setConnectionError('')
      setLiveNotes(nextNotes)
      try { localStorage.setItem('tech-titan-notes-cache', JSON.stringify(nextNotes)) } catch {}
    }).catch((error) => {
      if (active && error.code === 'API_UNREACHABLE') setConnectionError(error.message)
      })
    }
    const refreshNoticeBoard = () => {
      getNotices(session.token).then((nextNotices) => {
        if (active) {
          setNoticeBoard(nextNotices)
          try { localStorage.setItem('tech-titan-notices-cache', JSON.stringify(nextNotices)) } catch {}
        }
      }).catch(() => {
        if (active) setNoticeBoard([])
      })
    }
    const refreshAdminRoleRequests = () => {
      if (!isAdmin) return
      getAdminRoleRequests(session.token).then((result) => {
        if (!active) return
        setCanApproveAdminRequests(result.canApprove)
        setAdminRoleRequests(result.requests)
      }).catch(() => {
        if (active) {
          setCanApproveAdminRequests(false)
          setAdminRoleRequests([])
        }
      })
    }
    refreshNotes()
    refreshNoticeBoard()
    refreshAdminRoleRequests()
    const refreshTimer = window.setInterval(() => {
      refreshNotes()
      refreshNoticeBoard()
      refreshAdminRoleRequests()
    }, 30000)
    document.addEventListener('visibilitychange', refreshNotes)
    getFolders(session.token).then((nextFolders) => {
      if (active) {
        setFolders(nextFolders)
        try { localStorage.setItem('tech-titan-folders-cache', JSON.stringify(nextFolders)) } catch {}
      }
    }).catch(() => setFolders([]))
    if (isAdmin) {
      getAdminUsers(session.token).then(setAdminUsers).catch(() => setAdminUsers([]))
    } else {
      setAdminRoleRequests([])
      setCanApproveAdminRequests(false)
    }
    if (canManageContent) getAdminNotes(session.token).then(setAdminNotes).catch(() => setAdminNotes([]))
    return () => { active = false; window.clearInterval(refreshTimer); document.removeEventListener('visibilitychange', refreshNotes) }
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
    const location = new URL(window.location.href)
    location.searchParams.delete('signup')
    window.history.replaceState({}, '', location)
    localStorage.setItem('tech-titan-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setAuthOpen(false)
    setNotice('')
    setNewUploadCount(0)
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
    setNewUploadCount(0)
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
      setNewUploadCount(1)
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

  const handleSetContentPermissions = async (id, permissions, fullAdmin) => {
    try {
      const updated = await setUserPermissions(id, permissions, fullAdmin, session.token)
      if (updated.pendingApproval) {
        setNotice('Admin promotion request sent to the main admin for review.')
        return updated
      }
      setAdminUsers((users) => users.map((user) => user.id === id ? { ...user, ...updated } : user))
      setNotice('Access permissions saved. The user must sign in again.')
      return updated
    } catch (error) { setNotice(error.message) }
  }

  const handleAdminRoleRequestDecision = async (request, decision) => {
    try {
      const result = await decideAdminRoleRequest(request.id, decision, session.token)
      setAdminRoleRequests((requests) => requests.filter((item) => item.id !== request.id))
      if (result.status === 'approved') {
        setAdminUsers((users) => users.map((user) => user.id === result.targetUserId ? { ...user, role: 'admin', permissions: {} } : user))
      }
      setNotice(`Admin promotion request ${result.status}.`)
    } catch (error) { setNotice(error.message) }
  }

  const handleCreateNotice = async ({ title, message, type = 'general' }) => {
    try {
      const created = await createNotice({ title, message, type }, session.token)
      setNoticeBoard((current) => [created, ...current])
      setNotice('Notice published to the board.')
      return true
    } catch (error) {
      setNotice(error.message)
      return false
    }
  }

  const handleEditNotice = async (id, changes) => {
    try {
      const updated = await updateNotice(id, changes, session.token)
      setNoticeBoard((notices) => notices.map((item) => item.id === id ? { ...item, ...updated } : item))
      setNotice('Notice updated on the board.')
      return true
    } catch (error) {
      setNotice(error.message)
      return false
    }
  }

  const handleDeleteNotice = async (id) => {
    if (!window.confirm('Delete this notice from the board?')) return
    try {
      await deleteNotice(id, session.token)
      setNoticeBoard((notices) => notices.filter((item) => item.id !== id))
      setNotice('Notice deleted from the board.')
    } catch (error) { setNotice(error.message) }
  }

  const handleExportUsers = async () => {
    try {
      await downloadAdminExport(session.token)
      setNotice('Admin workbook downloaded.')
    } catch (error) { setNotice(error.message) }
  }

  const handleDeleteAllUsers = async () => {
    const count = adminUsers.filter((user) => user.role !== 'admin').length
    if (!count || !window.confirm(`Permanently delete all ${count} non-admin users? Their activity will be archived in the export.`)) return
    try {
      const result = await deleteAllAdminUsers(session.token)
      setAdminUsers((users) => users.filter((user) => user.role === 'admin'))
      setNotice(`${result.deletedCount} non-admin user(s) deleted.`)
    } catch (error) { setNotice(error.message) }
  }

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  useEffect(() => {
    if (view === 'profile' || view === 'admin') return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setView(entry.target.id);
          }
        });
      },
      { threshold: 0.5 }
    );
    const sections = ['home', 'notes', 'students'].map((id) => document.getElementById(id)).filter(Boolean);
    sections.forEach((s) => observer.observe(s));
    return () => sections.forEach((s) => observer.unobserve(s));
  }, [view]);


  return (
    <div className="app-shell dashboard-layout">
      {mobileNavOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        view={view}
        setView={setView}
        canManageContent={canManageContent}
        signedIn={signedIn}
        session={session}
        handleSignOut={handleSignOut}
        navigate={navigate}
        scrollTo={scrollTo}
        setAuthOpen={setAuthOpen}
      />

      <div className="main-content-wrapper">
        <header className="mobile-header">
          <button className="icon-button" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={22} /></button>
          <span className="mobile-brand-text">Tech <i>Titan</i></span>
          {signedIn && <button className="avatar-circle small" aria-label="Profile" onClick={() => navigate('profile')}>{session.user?.name?.slice(0, 2).toUpperCase() || 'TT'}</button>}
        </header>

        <main className="main-content"><Suspense fallback={<div className="loading-skeleton">Loading view...</div>}>
          {view === 'profile' && signedIn ? <ProfileView user={session.user} onSave={handleProfileSave} onBack={() => setView('home')} /> : <>
            <div id="home"><Home onExplore={() => scrollTo('notes')} onSignIn={() => setAuthOpen(true)} signedIn={signedIn} /></div>
            <div id="notes">
              {signedIn
                ? <NotesView subject={subject} setSubject={setSubject} search={search} setSearch={setSearch} studentYear={session.user?.year} folders={folders} notes={liveNotes} latestUploads={liveNotes.slice(0, 9)} newUploadCount={newUploadCount} onDismissNewUploads={() => setNewUploadCount(0)} connectionError={connectionError} onRetry={() => setConnectionAttempt((attempt) => attempt + 1)} onNoteAccess={handleNoteAccess} />
                : <section className="page-width access-section card"><LockKeyhole size={32} /><div><h2>Sign in to enter the library.</h2><p>Unlock premium notes and your student space.</p></div></section>}
            </div>
            <div id="students">{signedIn && <StudentsView onProfile={() => navigate('profile')} />}</div>
            {signedIn && <NoticeBoard notices={noticeBoard} canManage={canManageContent || isAdmin} onCreateNotice={handleCreateNotice} onDeleteNotice={handleDeleteNotice} onEditNotice={handleEditNotice} />}
            {isAdmin && <div id="admin"><AdminView users={adminUsers} notes={adminNotes} folders={folders} token={session.token} roleRequests={adminRoleRequests} canApproveAdminRequests={canApproveAdminRequests} onRoleRequestDecision={handleAdminRoleRequestDecision} onExport={handleExportUsers} onCreateFolder={handleCreateFolder} onCreateNote={handleAdminNote} onNoteStatus={handleNoteStatus} onEditFolder={handleEditFolder} onDeleteFolder={handleDeleteFolder} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} onUpdateUser={handleUpdateAdminUser} onDeleteAll={handleDeleteAllUsers} onBlock={async (id, blocked) => { await setUserBlocked(id, blocked, session.token); setAdminUsers((users) => users.map((user) => user.id === id ? { ...user, blocked } : user)) }} onDelete={async (id) => { try { await deleteAdminUser(id, session.token); setAdminUsers((users) => users.filter((user) => user.id !== id)); setNotice('User deleted from access management.') } catch (error) { setNotice(error.message) } }} /></div>}
            {isAdmin && <ContentAdminManager users={adminUsers} canApproveAdminRequests={canApproveAdminRequests} onSavePermissions={handleSetContentPermissions} />}
            {canManageContent && !isAdmin && <div id="admin"><ContentAdminView folders={folders} notes={adminNotes} permissions={session.user.role === 'content_admin' ? Object.fromEntries(notePermissionOptions.map(({ key }) => [key, true])) : (session.user.permissions || {})} onCreateNote={handleAdminNote} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} onNoteStatus={handleNoteStatus} /></div>}
          </>}
        </Suspense></main>
      </div>

      {notice && (
        <aside className="toast-notification crazy-notice-box" role="status" aria-live="polite">
          <div className="notice-box-glow"></div>
          <div className="notice-box-header">
            <div className="notice-status-badge">
              <span className="notice-beacon-ring"></span>
              <span className="notice-badge-title">⚡ OFFICIAL NOTICE</span>
            </div>
            <div className="notice-timestamp-pill">
              <Clock3 size={12} />
              <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
            </div>
            <button className="notice-close-button" onClick={() => setNotice('')} aria-label="Dismiss notice">
              <X size={15} />
            </button>
          </div>
          <div className="notice-box-content">
            <span className="notice-icon-frame">
              <Bell size={18} />
            </span>
            <div className="notice-text-wrapper">
              <p className="notice-message-text">{notice}</p>
            </div>
          </div>
          <div className="notice-timer-bar"></div>
        </aside>
      )}
      {authOpen && <Suspense fallback={<div className="modal-overlay"><div className="modal-content"><div className="loading-skeleton">Loading...</div></div></div>}><AuthModal onClose={() => setAuthOpen(false)} onSuccess={handleAuthSuccess} /></Suspense>}
      {adminOpen && signedIn && <AddNoteModal onClose={() => setAdminOpen(false)} onSubmit={handleCreateNote} />}
    </div>
  )
}

function Home({ onExplore, onSignIn, signedIn }) {
  // Parallax: the desk items drift slightly with the pointer (skipped for reduced motion).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    const move = (e) => {
      root.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3))
      root.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3))
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  const ticker = [...subjects, 'Computer Networks', 'Machine Learning']

  return <>
    <section className="hero page-width">
      <div>
        <div className="eyebrow"><span className="live-dot" /> the student knowledge room</div>
        <h1>Make your next chapter count.</h1>
        <p>Notes, people and momentum for the ones building what comes next. A calmer way to study together.</p>
        <button className="button button-ink" onClick={onSignIn}>Sign in or sign up <ArrowUpRight size={17} /></button>
        <div className="hero-proof">
          <div className="avatar-stack">
            <span style={{ background: 'var(--pink)' }}>AM</span><span style={{ background: 'var(--cyan)' }}>MI</span>
            <span style={{ background: 'var(--yellow)' }}>KS</span><span style={{ background: 'var(--mint)' }}>+8k</span>
          </div>
          <span><strong>8,240+</strong> learners are in the room</span>
        </div>
      </div>

      <div className="hero-desk" aria-hidden="true">
        <div className="desk-item desk-tab" style={{ '--r': '2deg', '--d': 8, '--delay': '.5s' }}>3rd year</div>
        <div className="desk-item desk-card" style={{ '--r': '-4deg', '--d': 14 }}>
          <span className="tag">DSA â€¢ graphs</span>
          <h3>Patterns over memorizing.</h3>
          <div className="by"><span>By Meera Iyer</span><ArrowUpRight size={16} /></div>
        </div>
        <div className="desk-item desk-sheet" style={{ '--r': '3deg', '--d': 22, '--delay': '.2s' }}>
          <b>Normalisation, quickly</b>
          <p><span className="hl">1NF removes repeating groups.</span> <span className="hl-pink">2NF removes partial dependencies.</span> <span className="hl">3NF removes transitive ones.</span></p>
        </div>
        <div className="desk-item desk-sticky" style={{ '--r': '-6deg', '--d': 30, '--delay': '.35s' }}><FileText size={20} /> New notes every week!</div>
        <div className="desk-item desk-stamp" style={{ '--r': '-12deg', '--d': 36, '--delay': '.65s' }}>approved<br />by admins</div>
      </div>
    </section>

    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">{[...ticker, ...ticker].map((item, i) => <span key={i}>{item}</span>)}</div>
    </div>

    <section className="page-width">
      <div className="pillars">
        <div className="pillar"><b>One focused place</b><small>for your academic life</small></div>
        <div className="pillar"><b>Real notes, real people</b><small>no noise, no endless feeds</small></div>
        <div className="pillar"><b>Made to move with you</b><small>from first year to first job</small></div>
      </div>
    </section>

    <section className="page-width" style={{ paddingTop: 0 }}>
      <div className="section-head">
        <div><span className="eyebrow">private student room</span><h2>Notes worth<br />keeping close.</h2></div>
        <button className="round-btn" onClick={onExplore} aria-label="Go to the library"><ArrowUpRight size={22} /></button>
      </div>
      <div className="teaser-board">
        <div className="teaser-cards" aria-hidden="true"><div className="ghost-note" /><div className="ghost-note" /><div className="ghost-note" /></div>
        <div className="teaser-lock card">
          <span className="icon-tile pink"><LockKeyhole size={22} /></span>
          <div>
            <h3>{signedIn ? 'Your library is ready.' : 'Sign in to unlock the library.'}</h3>
            <p>Only signed-in members can view notes and Drive links. Everyone who is signed in can contribute.</p>
          </div>
        </div>
      </div>
    </section>
  </>
}

export default App

