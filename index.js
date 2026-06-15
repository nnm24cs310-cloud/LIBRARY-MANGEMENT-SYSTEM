const express = require('express');
const db      = require('./db');
const session = require('express-session');
const path    = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({ secret: 'library_secret_2024', resave: false, saveUninitialized: false }));

// ── Auth guards ────────────────────────────────────────────────────────────────
const isLibrarian = (req, res, next) => req.session.librarian ? next() : res.redirect('/librarian/login');
const isStudent   = (req, res, next) => req.session.student   ? next() : res.redirect('/');

// ══════════════════════════════════════════════════════════════════════════════
//  STUDENT PORTAL
// ══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    if (req.session.student) return res.redirect('/student/dashboard');
    res.send(studentLoginHTML());
});

app.get('/student/dashboard', isStudent, (req, res) => {
    res.send(studentDashboardHTML(req.session.student));
});

// Accept any non-empty USN — no format restriction
app.post('/student/login', (req, res) => {
    const { usn } = req.body;
    if (!usn || !usn.trim()) return res.status(400).json({ error: 'USN is required.' });

    const cleanUSN = usn.trim().toUpperCase();

    // ── Current date & time (server JS) ──────────────────────────────────────
    const now        = new Date();
    const visitDate  = now.toLocaleDateString('en-IN', { year:'numeric', month:'2-digit', day:'2-digit' }).split('/').reverse().join('-'); // YYYY-MM-DD
    const entryTime  = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true }); // e.g. 02:35 PM

    db.get('SELECT * FROM STUDENT WHERE USN = ?', [cleanUSN], (err, student) => {
        if (err) return res.status(500).json({ error: 'Database error.' });

        const recordVisitAndRespond = (usnKey) => {
            // Insert visit record with current time (exit_time & duration filled on logout/later)
            db.run(
                `INSERT INTO LibraryVisits (usn, visit_date, entry_time, exit_time, duration)
                 VALUES (?, ?, ?, ?, ?)`,
                [usnKey, visitDate, entryTime, '—', '—'],
                () => {}  // fire and forget
            );
        };

        if (!student) {
            // Auto-register new student then record visit
            db.run(`INSERT INTO STUDENT (USN,FULLNAME,SEM,BRANCH,CONTACT,CGPA) VALUES (?,?,?,?,?,?)`,
                [cleanUSN, 'Student ' + cleanUSN, 1, 'N/A', 'N/A', 0.0],
                function(insertErr) {
                    if (insertErr) {
                        console.error('Auto-register failed:', insertErr.message);
                        return res.status(500).json({ error: 'Could not register student: ' + insertErr.message });
                    }
                    recordVisitAndRespond(cleanUSN);
                    req.session.student = {
                        USN: cleanUSN, FULLNAME: 'Student ' + cleanUSN,
                        SEM: 1, BRANCH: 'N/A', CONTACT: 'N/A', CGPA: 0.0,
                        loginTime: entryTime, loginDate: visitDate,
                        borrowedCount: 0, visitCount: 1, borrowedBooks: [], visits: []
                    };
                    res.json({ redirect: '/student/dashboard' });
                }
            );
            return;
        }

        // Existing student — record visit then load full data
        recordVisitAndRespond(student.USN);

        db.get('SELECT COUNT(*) AS cnt FROM BorrowedBooks WHERE USN=?', [student.USN], (_err, bc) => {
            db.get('SELECT COUNT(*) AS cnt FROM LibraryVisits WHERE usn=?', [student.USN], (_err, vc) => {
                db.all(`SELECT b.title, b.author, bb.status, bb.borrowed_date, bb.return_date
                        FROM BorrowedBooks bb JOIN Book b ON bb.book_id=b.id
                        WHERE bb.USN=? ORDER BY bb.id DESC`, [student.USN], (_err, bbooks) => {
                    db.all(`SELECT visit_date, entry_time, exit_time, duration
                            FROM LibraryVisits WHERE usn=? ORDER BY id DESC LIMIT 5`,
                        [student.USN], (_err, visits) => {
                            req.session.student = {
                                ...student,
                                loginTime:     entryTime,
                                loginDate:     visitDate,
                                borrowedCount: bc ? bc.cnt : 0,
                                visitCount:    vc ? vc.cnt : 0,
                                borrowedBooks: bbooks || [],
                                visits:        visits || []
                            };
                            res.json({ redirect: '/student/dashboard' });
                        });
                });
            });
        });
    });
});

app.post('/student/logout', (req, res) => {
    const student = req.session.student;
    if (student && student.USN) {
        const now      = new Date();
        const exitTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

        // Calculate duration from login time stored in session
        const loginDate  = student.loginDate;  // YYYY-MM-DD
        const loginTime  = student.loginTime;  // e.g. "02:35 PM"

        let durationStr = '—';
        try {
            const parseTime = (dateStr, timeStr) => {
                // timeStr is like "02:35 PM"
                const [time, period] = timeStr.split(' ');
                let [h, m] = time.split(':').map(Number);
                if (period === 'PM' && h !== 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                const d = new Date(dateStr);
                d.setHours(h, m, 0, 0);
                return d;
            };
            const entry    = parseTime(loginDate, loginTime);
            const exit     = now;
            const diffMins = Math.round((exit - entry) / 60000);
            if (diffMins >= 0) {
                const hrs = Math.floor(diffMins / 60);
                const mins = diffMins % 60;
                durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            }
        } catch (e) { /* keep '—' */ }

        // Update the most recent open visit for this student (exit_time = '—')
        db.run(
            `UPDATE LibraryVisits SET exit_time = ?, duration = ?
             WHERE id = (
               SELECT id FROM LibraryVisits
               WHERE usn = ? AND exit_time = '—'
               ORDER BY id DESC LIMIT 1
             )`,
            [exitTime, durationStr, student.USN],
            () => {}
        );
    }
    req.session.student = null;
    res.redirect('/');
});

// ══════════════════════════════════════════════════════════════════════════════
//  LIBRARIAN PORTAL
// ══════════════════════════════════════════════════════════════════════════════

app.get('/librarian/login', (req, res) => {
    if (req.session.librarian) return res.redirect('/librarian/dashboard');
    res.render('login', { error: null });
});

app.post('/librarian/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM Librarian WHERE email=? AND password=?', [email, password], (err, row) => {
        if (err || !row) return res.render('login', { error: err ? 'Database Error' : 'Invalid Credentials' });
        req.session.librarian = row;
        res.redirect('/librarian/dashboard');
    });
});

app.get('/librarian/dashboard', isLibrarian, (req, res) => {
    db.get('SELECT COUNT(*) AS c FROM Book', (_err, b) => {
        db.get('SELECT COUNT(*) AS c FROM BorrowedBooks', (_err, br) => {
            db.get('SELECT COUNT(*) AS c FROM LibraryVisits', (_err, v) => {
                db.get('SELECT COUNT(*) AS c FROM STUDENT', (_err, s) => {
                    res.render('dashboard', {
                        librarian:     req.session.librarian,
                        totalBooks:    b  ? b.c  : 0,
                        totalBorrowed: br ? br.c : 0,
                        totalVisits:   v  ? v.c  : 0,
                        totalStudents: s  ? s.c  : 0
                    });
                });
            });
        });
    });
});

// ── Books CRUD ─────────────────────────────────────────────────────────────────
app.get('/books', isLibrarian, (_req, res) => {
    db.all('SELECT * FROM Book ORDER BY id', (_err, rows) => {
        res.render('books', { books: rows || [] });
    });
});

app.get('/books/add', isLibrarian, (_req, res) => res.render('addBook'));

app.post('/books/add', isLibrarian, (req, res) => {
    const { title, author, quantity } = req.body;
    db.run('INSERT INTO Book(title,author,quantity) VALUES(?,?,?)',
        [title, author, quantity], () => res.redirect('/books'));
});
app.get('/books/edit/:id', isLibrarian, (req, res) => {
    db.get('SELECT * FROM Book WHERE id=?', [req.params.id], (_err, row) => {
        if (!row) return res.redirect('/books');
        res.render('editBook', { book: row });
    });
});

app.post('/books/edit/:id', isLibrarian, (req, res) => {
    const { title, author, quantity } = req.body;
    db.run('UPDATE Book SET title=?,author=?,quantity=? WHERE id=?',
        [title, author, quantity, req.params.id], () => res.redirect('/books'));
});

app.get('/books/delete/:id', isLibrarian, (req, res) => {
    db.run('DELETE FROM Book WHERE id=?', [req.params.id], () => res.redirect('/books'));
});
// ── Borrowed Books ─────────────────────────────────────────────────────────────
app.get('/borrowed', isLibrarian, (_req, res) => {
    db.all(`SELECT bb.id, bb.USN, s.FULLNAME as studentName, s.BRANCH,
                   b.id as bookId, b.title, b.author,
                   bb.borrowed_date, bb.return_date, bb.status
            FROM BorrowedBooks bb
            JOIN Book b    ON bb.book_id = b.id
            JOIN STUDENT s ON bb.USN     = s.USN
            ORDER BY bb.id DESC`, (_err, rows) => {
        res.render('borrowed', { records: rows || [] });
    });
});

// ── Library Visits ─────────────────────────────────────────────────────────────
app.get('/visits', isLibrarian, (_req, res) => {
    db.all(`SELECT lv.id, lv.usn, s.FULLNAME, s.BRANCH, s.SEM,
                   lv.visit_date, lv.entry_time, lv.exit_time, lv.duration
            FROM LibraryVisits lv
            LEFT JOIN STUDENT s ON lv.usn = s.USN
            ORDER BY lv.id DESC`, (_err, rows) => {
        db.get('SELECT COUNT(DISTINCT usn) AS uniqueStudents FROM LibraryVisits', (_err, stat) => {
            res.render('visits', {
                records:        rows || [],
                uniqueStudents: stat ? stat.uniqueStudents : 0
            });
        });
    });
});

app.get('/librarian/logout', (req, res) => { req.session.librarian = null; res.redirect('/librarian/login'); });

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(3000, () => {
    console.log('\n🚀 Library System running on http://localhost:3000');
    console.log('   Student  Portal → http://localhost:3000/');
    console.log('   Librarian Portal → http://localhost:3000/librarian/login\n');
});


// ══════════════════════════════════════════════════════════════════════════════
//  HTML TEMPLATES (Student pages — React via CDN)
// ══════════════════════════════════════════════════════════════════════════════

function studentLoginHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Student Login – Library</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;min-height:100vh;
      background:linear-gradient(135deg,#dbeafe 0%,#f0fdf4 55%,#fef9c3 100%);
      display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:22px;padding:46px 40px 38px;
      width:100%;max-width:430px;box-shadow:0 12px 48px rgba(0,0,0,0.11);
      border:1px solid #e2e8f0}
    .logo{text-align:center;margin-bottom:30px}
    .logo-icon{font-size:3rem;display:block;margin-bottom:8px}
    .logo h1{font-size:1.5rem;font-weight:800;color:#0f172a}
    .logo p{font-size:0.82rem;color:#64748b;margin-top:4px}
    label{display:block;font-size:0.78rem;font-weight:700;color:#475569;
      margin-bottom:7px;text-transform:uppercase;letter-spacing:0.6px}
    .input-wrap{position:relative;margin-bottom:6px}
    .input-wrap span{position:absolute;left:13px;top:50%;transform:translateY(-50%);font-size:1rem}
    input{width:100%;padding:13px 14px 13px 38px;border:1.5px solid #cbd5e1;
      border-radius:11px;font-size:0.97rem;color:#0f172a;background:#f8fafc;
      outline:none;transition:border-color .2s,box-shadow .2s;letter-spacing:1px;font-weight:600}
    input::placeholder{color:#94a3b8;font-weight:400;letter-spacing:0}
    input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.13);background:#fff}
    .hint{font-size:0.74rem;color:#94a3b8;margin-top:5px;margin-bottom:16px}
    .btn{width:100%;padding:13px;background:linear-gradient(135deg,#3b82f6,#6366f1);
      border:none;border-radius:11px;color:#fff;font-size:0.97rem;font-weight:700;
      cursor:pointer;margin-top:4px;transition:opacity .2s,transform .1s;letter-spacing:.3px}
    .btn:hover:not(:disabled){opacity:.87}
    .btn:active:not(:disabled){transform:scale(.98)}
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .error{background:#fef2f2;border:1px solid #fecaca;border-radius:9px;
      padding:10px 14px;font-size:.86rem;color:#dc2626;margin-bottom:16px;text-align:center}
    .divider{display:flex;align-items:center;gap:10px;margin:22px 0 18px}
    .divider hr{flex:1;border:none;border-top:1px solid #e2e8f0}
    .divider span{font-size:.76rem;color:#94a3b8;white-space:nowrap}
    .lib-link{display:block;width:100%;padding:12px;border:1.5px solid #e2e8f0;
      border-radius:11px;background:#f8fafc;color:#475569;font-size:.9rem;
      font-weight:600;text-align:center;text-decoration:none;transition:all .2s}
    .lib-link:hover{background:#f1f5f9;border-color:#94a3b8;color:#1e293b}
    .spinner{width:17px;height:17px;border:2.5px solid rgba(255,255,255,.35);
      border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;
      display:inline-block;vertical-align:middle;margin-right:7px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const {useState} = React;

function LoginPage() {
  const [usn, setUsn]       = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = usn.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your USN.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/student/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ usn: trimmed })
      });
      const data = await res.json();
      if (res.ok && data.redirect) { window.location.href = data.redirect; }
      else { setError(data.error || 'Login failed.'); }
    } catch { setError('Server error. Please try again.'); }
    finally   { setLoading(false); }
  };

  return (
    <div className="card">
      <div className="logo">
        <span className="logo-icon">📚</span>
        <h1>Student Library Portal</h1>
        <p>NNM Institute of Technology</p>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      <form onSubmit={handleSubmit}>
        <label htmlFor="usn">University Seat Number (USN)</label>
        <div className="input-wrap">
          <span>🎓</span>
          <input id="usn" type="text"
            placeholder="e.g. NNM24CS310"
            value={usn}
            onChange={e => { setUsn(e.target.value.toUpperCase()); setError(''); }}
            maxLength={18} autoComplete="off" spellCheck="false"
          />
        </div>
        <p className="hint">Enter any USN — e.g. NNM24CS310, 123, or any ID</p>
        <button className="btn" type="submit" disabled={loading || usn.trim().length < 1}>
          {loading ? <><span className="spinner"/>Verifying…</> : '→  Login with USN'}
        </button>
      </form>

      <div className="divider"><hr/><span>librarian access</span><hr/></div>
      <a href="/librarian/login" className="lib-link">🔑  Librarian Login</a>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<LoginPage/>);
</script>
</body>
</html>`;
}

function studentDashboardHTML(student) {
    const initials = (student.FULLNAME || 'ST').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const cgpaColor = student.CGPA >= 8.5 ? '#16a34a' : student.CGPA >= 7 ? '#d97706' : '#dc2626';

    const borrowedRows = (student.borrowedBooks || []).map(b => `
      <tr>
        <td>${b.title}</td>
        <td style="color:#64748b">${b.author}</td>
        <td>${b.borrowed_date || '—'}</td>
        <td>${b.return_date  || '—'}</td>
        <td><span class="badge ${b.status==='Returned'?'badge-green':'badge-yellow'}">${b.status}</span></td>
      </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No borrowed books</td></tr>`;

    const visitRows = (student.visits || []).map(v => `
      <tr>
        <td>${v.visit_date  || '—'}</td>
        <td>${v.entry_time}</td>
        <td>${v.exit_time === '—' ? '<span class="badge badge-yellow">🟢 Active</span>' : v.exit_time}</td>
        <td><span class="badge badge-blue">⏱ ${v.duration === '—' ? 'In progress' : v.duration}</span></td>
      </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No visits recorded</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${student.FULLNAME} – Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#f0f9ff;min-height:100vh;padding:24px 16px 48px}
    .wrap{max-width:760px;margin:0 auto}
    .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:10px;flex-wrap:wrap}
    .brand{font-size:1.05rem;font-weight:800;color:#0369a1;display:flex;align-items:center;gap:8px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}
    .btn-light{padding:8px 15px;border-radius:8px;font-size:.82rem;font-weight:600;
      border:1.5px solid #cbd5e1;background:#fff;color:#475569;text-decoration:none;
      cursor:pointer;transition:.2s}
    .btn-light:hover{background:#f1f5f9;border-color:#94a3b8}
    .btn-red{padding:8px 15px;border-radius:8px;font-size:.82rem;font-weight:600;
      border:1.5px solid #fca5a5;background:#fff;color:#dc2626;cursor:pointer;transition:.2s}
    .btn-red:hover{background:#fef2f2}
    .profile{background:linear-gradient(135deg,#0ea5e9,#6366f1);border-radius:18px;
      padding:26px 28px;margin-bottom:20px;display:flex;align-items:center;gap:18px;
      box-shadow:0 6px 28px rgba(14,165,233,.22);flex-wrap:wrap}
    .avatar{width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.25);
      display:flex;align-items:center;justify-content:center;font-size:1.35rem;
      font-weight:800;color:#fff;flex-shrink:0;border:2px solid rgba(255,255,255,.5)}
    .profile h2{font-size:1.15rem;font-weight:800;color:#fff}
    .profile p{font-size:.83rem;color:rgba(255,255,255,.82);margin-top:3px}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
    .stat{background:#fff;border-radius:14px;padding:20px;text-align:center;
      box-shadow:0 2px 14px rgba(0,0,0,.06);border:1px solid #e2e8f0}
    .stat .ico{font-size:1.5rem;margin-bottom:5px}
    .stat .val{font-size:1.6rem;font-weight:800;color:#0f172a}
    .stat .lbl{font-size:.7rem;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
    .card{background:#fff;border-radius:14px;padding:20px 22px;margin-bottom:18px;
      box-shadow:0 2px 14px rgba(0,0,0,.06);border:1px solid #e2e8f0}
    .card-title{font-size:.77rem;font-weight:700;color:#94a3b8;text-transform:uppercase;
      letter-spacing:.6px;margin-bottom:14px;display:flex;align-items:center;gap:6px}
    .info-row{display:flex;justify-content:space-between;align-items:center;
      padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:.9rem}
    .info-row:last-child{border-bottom:none}
    .ik{color:#64748b}.iv{color:#0f172a;font-weight:600}
    table{width:100%;border-collapse:collapse;font-size:.88rem}
    th{background:#f8fafc;color:#64748b;font-size:.74rem;font-weight:700;
      text-transform:uppercase;letter-spacing:.5px;padding:10px 12px;text-align:left;
      border-bottom:1.5px solid #e2e8f0}
    td{padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#f8fafc}
    .badge{padding:3px 10px;border-radius:999px;font-size:.73rem;font-weight:700;white-space:nowrap}
    .badge-yellow{background:#fef9c3;color:#b45309;border:1px solid #fde68a}
    .badge-green {background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}
    .badge-blue  {background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe}
    @media(max-width:520px){.stats{grid-template-columns:1fr 1fr}.profile{flex-direction:column;text-align:center}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand">📚 NNM Library</div>
    <div class="actions">
      <a href="/librarian/login" class="btn-light">🔑 Librarian Portal</a>
      <form action="/student/logout" method="POST" style="display:inline">
        <button type="submit" class="btn-red">🚪 Logout</button>
      </form>
    </div>
  </div>

  <div class="profile">
    <div class="avatar">${initials}</div>
    <div>
      <h2>${student.FULLNAME}</h2>
      <p>USN: ${student.USN} &nbsp;•&nbsp; Sem ${student.SEM} &nbsp;•&nbsp; ${student.BRANCH} &nbsp;•&nbsp; 📞 ${student.CONTACT}</p>
      <p style="margin-top:6px;font-size:.78rem;background:rgba(255,255,255,.18);
         display:inline-block;padding:3px 10px;border-radius:20px;color:#fff">
        🕐 Entered at ${student.loginTime} &nbsp;|&nbsp; 📅 ${student.loginDate}
      </p>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><div class="ico">📖</div><div class="val">${student.borrowedCount}</div><div class="lbl">Borrowed</div></div>
    <div class="stat"><div class="ico">🏛️</div><div class="val">${student.visitCount}</div><div class="lbl">Visits</div></div>
    <div class="stat"><div class="ico">⭐</div><div class="val" style="color:${cgpaColor}">${student.CGPA}</div><div class="lbl">CGPA</div></div>
  </div>

  <div class="card">
    <div class="card-title">👤 Personal Details</div>
    <div class="info-row"><span class="ik">Full Name</span><span class="iv">${student.FULLNAME}</span></div>
    <div class="info-row"><span class="ik">USN</span><span class="iv">${student.USN}</span></div>
    <div class="info-row"><span class="ik">Semester</span><span class="iv">${student.SEM}</span></div>
    <div class="info-row"><span class="ik">Branch</span><span class="iv">${student.BRANCH}</span></div>
    <div class="info-row"><span class="ik">Contact</span><span class="iv">${student.CONTACT}</span></div>
    <div class="info-row"><span class="ik">CGPA</span><span class="iv" style="color:${cgpaColor}">${student.CGPA}</span></div>
  </div>

  <div class="card">
    <div class="card-title">📚 Borrowed Books</div>
    <table>
      <thead><tr><th>Title</th><th>Author</th><th>Borrowed</th><th>Return By</th><th>Status</th></tr></thead>
      <tbody>${borrowedRows}</tbody>
    </table>
  </div>

  <div class="card">
    <div class="card-title">🏛️ Recent Library Visits</div>
    <table>
      <thead><tr><th>Date</th><th>Entry</th><th>Exit</th><th>Duration</th></tr></thead>
      <tbody>${visitRows}</tbody>
    </table>
  </div>
</div>
</body>
</html>`;
}
