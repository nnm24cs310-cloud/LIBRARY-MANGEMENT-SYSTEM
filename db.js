const sqlite3 = require('sqlite3');

const db = new sqlite3.Database('library.db', (err) => {
    if (err) {
        console.log(err.message);
    } else {
        console.log('Connected to database');
    }
});

db.serialize(() => {

    db.run(`CREATE TABLE IF NOT EXISTS Librarian (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        FULLNAME TEXT,
        email    TEXT UNIQUE,
        password TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS STUDENT (
        USN     TEXT PRIMARY KEY,
        FULLNAME TEXT,
        SEM     INTEGER,
        BRANCH  TEXT,
        CONTACT TEXT,
        CGPA    REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Book (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        title    TEXT,
        author   TEXT,
        quantity INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS BorrowedBooks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        USN           TEXT,
        book_id       INTEGER,
        borrowed_date TEXT,
        return_date   TEXT,
        status        TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS LibraryVisits (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        usn        TEXT,
        visit_date TEXT,
        entry_time TEXT,
        exit_time  TEXT,
        duration   TEXT
    )`);

    
    db.run(`ALTER TABLE LibraryVisits ADD COLUMN visit_date TEXT`, () => {});

    

    db.run(`INSERT OR IGNORE INTO Librarian (id,FULLNAME,email,password) VALUES
        (1,'Admin One',  'admin1@gmail.com','admin123'),
        (2,'Admin Two',  'admin2@gmail.com','admin123'),
        (3,'Admin Three','admin3@gmail.com','admin123')`);

    db.run(`INSERT OR IGNORE INTO STUDENT (USN,FULLNAME,SEM,BRANCH,CONTACT,CGPA) VALUES
        ('NNM23CS001','Rahul Kumar',   3,'CSE','9876543210',8.5),
        ('NNM23CS002','Priya Sharma',  3,'CSE','9876543211',8.8),
        ('NNM23ISE003','Arjun Patel',  5,'ISE','9876543212',8.1),
        ('NNM23ECE004','Sneha Rao',    5,'ECE','9876543213',9.0),
        ('NNM23ME005', 'Kiran Reddy',  7,'ME', '9876543214',7.9)`);

    db.run(`INSERT OR IGNORE INTO Book (id,title,author,quantity) VALUES
        (1,'C Programming',        'Dennis Ritchie',10),
        (2,'Database Systems',     'Henry Korth',    8),
        (3,'Operating Systems',    'Galvin & Gagne', 6),
        (4,'Computer Networks',    'Andrew Tanenbaum',7),
        (5,'Software Engineering', 'Ian Sommerville', 5),
        (6,'Data Structures',      'Mark Allen Weiss',9),
        (7,'Algorithms',           'CLRS',            4)`);

    db.run(`INSERT OR IGNORE INTO BorrowedBooks (id,USN,book_id,borrowed_date,return_date,status) VALUES
        (1,'NNM23CS001', 1,'2026-06-01','2026-06-15','Borrowed'),
        (2,'NNM23CS002', 2,'2026-06-02','2026-06-16','Borrowed'),
        (3,'NNM23ISE003',3,'2026-06-03','2026-06-17','Returned'),
        (4,'NNM23ECE004',4,'2026-06-04','2026-06-18','Borrowed'),
        (5,'NNM23ME005', 5,'2026-06-05','2026-06-19','Returned'),
        (6,'NNM23CS001', 6,'2026-06-08','2026-06-22','Borrowed'),
        (7,'NNM23CS002', 7,'2026-06-09','2026-06-23','Returned')`);

    db.run(`INSERT OR IGNORE INTO LibraryVisits (id,usn,visit_date,entry_time,exit_time,duration) VALUES
        (1,'NNM23CS001', '2026-06-10','09:00','10:30','1h 30m'),
        (2,'NNM23CS002', '2026-06-10','10:00','11:00','1h'),
        (3,'NNM23ISE003','2026-06-11','11:00','12:15','1h 15m'),
        (4,'NNM23ECE004','2026-06-11','13:00','14:30','1h 30m'),
        (5,'NNM23ME005', '2026-06-12','15:00','16:00','1h'),
        (6,'NNM23CS001', '2026-06-12','09:30','11:00','1h 30m'),
        (7,'NNM23CS002', '2026-06-13','10:00','10:45','45m')`);

});

module.exports = db;
