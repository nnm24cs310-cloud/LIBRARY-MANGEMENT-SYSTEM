const express = require('express');
const db = require('./db');
const session = require('express-session');

const app = express();

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'librarysecret',
    resave: false,
    saveUninitialized: false
}));

function isLoggedIn(req, res, next) {
    if (req.session.librarian) {
        next();
    } else {
        res.redirect('/');
    }
}

app.get('/', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {

    const { email, password } = req.body;

    db.get(
        'SELECT * FROM Librarian WHERE email=? AND password=?',
        [email, password],
        (err, row) => {

            if (err) {
                return res.render('login', {
                    error: 'Database Error'
                });
            }

            if (!row) {
                return res.render('login', {
                    error: 'Invalid Credentials'
                });
            }

            req.session.librarian = row;
            res.redirect('/dashboard');
        }
    );
});

app.get('/dashboard', isLoggedIn, (req, res) => {

    db.get('SELECT COUNT(*) AS totalBooks FROM Book', (err, books) => {

        db.get('SELECT COUNT(*) AS totalBorrowed FROM BorrowedBooks', (err, borrowed) => {

            db.get('SELECT COUNT(*) AS totalVisits FROM LibraryVisits', (err, visits) => {

                res.render('dashboard', {
                    librarian: req.session.librarian,
                    totalBooks: books.totalBooks,
                    totalBorrowed: borrowed.totalBorrowed,
                    totalVisits: visits.totalVisits
                });

            });

        });

    });

});

app.get('/books', isLoggedIn, (req, res) => {

    db.all('SELECT * FROM Book', (err, rows) => {

        if (err) {
            console.log(err.message);
            return res.send('Database Error');
        }

        res.render('books', {
            books: rows
        });

    });

});

app.get('/books/add', isLoggedIn, (req, res) => {
    res.render('addBook');
});

app.post('/books/add', isLoggedIn, (req, res) => {

    const { title, author, quantity } = req.body;

    db.run(
        'INSERT INTO books(title,author,quantity) VALUES(?,?,?)',
        [title, author, quantity],
        (err) => {

            if (err) {
                console.log(err.message);
            }

            res.redirect('/books');
        }
    );

});

app.get('/books/delete/:id', isLoggedIn, (req, res) => {

    db.run(
        'DELETE FROM books WHERE id=?',
        [req.params.id],
        (err) => {

            if (err) {
                console.log(err.message);
            }

            res.redirect('/books');
        }
    );

});
app.get('books/edit/:id', (req, res) => {
    db.get(`select * from books where id=?`, [req.params.id], (err, row) => {

    })
})
app.post('/books/edit/:id', (req, res) => {

    const { title, author, quantity } = req.body;

    db.run(
        'UPDATE Book SET title = ?, author = ?, quantity = ? WHERE id = ?',
        [title, author, quantity, req.params.id],
        (err) => {

            if (err) {
                console.log(err.message);
                return res.send('Update Failed');
            }

            res.redirect('/books');
        }
    );

});
app.get('/logout', (req, res) => {

    req.session.destroy(() => {
        res.redirect('/');
    });

});

app.listen(5005, () => {
    console.log('⚠️  app.js (old file) running on port 5005 — use index.js on port 3000 instead');
    console.log('   Run: node index.js');
});