
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Routes
app.get('/', (req, res) => {
  res.render('home', { user: req.session.user });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/login', (req, res) => {
  // Add login logic here
  res.redirect('/');
});

app.post('/register', (req, res) => {
  // Add registration logic here
  res.redirect('/login');
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
