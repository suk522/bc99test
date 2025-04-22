
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const User = require('./models/User');
const Transaction = require('./models/Transaction');

const app = express();
app.use(expressLayouts);
app.set('layout', 'layout');

// Connect to MongoDB
mongoose.connect('mongodb+srv://sukhdevgodara964:KDKUc5zk70RNaJ5X@cluster0.ejnvmdj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Routes
app.get('/', (req, res) => {
  res.redirect('/home');
});

app.get('/home', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  res.render('home', { user });
});

app.get('/activity', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  res.render('activity', { user });
});

app.get('/wallet', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  const transactions = await Transaction.find({ userId: user._id }).sort({ date: -1 });
  res.render('wallet', { user, transactions });
});

app.post('/wallet/deposit', isAuthenticated, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const user = await User.findById(req.session.user._id);
    
    user.balance += amount;
    await user.save();
    
    const transaction = new Transaction({
      userId: user._id,
      type: 'deposit',
      amount: amount
    });
    await transaction.save();
    
    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing deposit');
  }
});

app.post('/wallet/withdraw', isAuthenticated, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const user = await User.findById(req.session.user._id);
    
    if (user.balance < amount) {
      return res.status(400).send('Insufficient balance');
    }
    
    user.balance -= amount;
    await user.save();
    
    const transaction = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount: amount
    });
    await transaction.save();
    
    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing withdrawal');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = new User({ username, password });
    await user.save();
    res.redirect('/login');
  } catch (error) {
    res.status(400).send('Error registering user');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (user && user.password === password) {
      if (user.banned) {
        return res.status(403).send('Account has been banned');
      }
      req.session.user = user;
      res.redirect('/');
    } else {
      res.redirect('/login');
    }
  } catch (error) {
    res.status(400).send('Error logging in');
  }
});

// Admin middleware
const isAdmin = (req, res, next) => {
  if (req.session.isAdmin === true) {
    next();
  } else {
    res.redirect('/admin-login');
  }
};

app.get('/admin-login', (req, res) => {
  if (req.session.isAdmin === true) {
    return res.redirect('/admin');
  }
  res.render('admin-login');
});

app.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;
  
  if (username === "1" && password === "1") {
    req.session.isAdmin = true;
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    res.redirect('/admin');
  } else {
    res.redirect('/admin-login?error=1');
  }
});

app.get('/admin', isAdmin, async (req, res) => {
  const users = await User.find();
  res.render('admin', { users });
});

app.post('/admin/edit-user/:id', isAdmin, async (req, res) => {
  try {
    const { username, balance } = req.body;
    await User.findByIdAndUpdate(req.params.id, { username, balance });
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error updating user');
  }
});

app.post('/admin/toggle-ban/:id', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    user.banned = !user.banned;
    await user.save();
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error toggling ban status');
  }
});

app.get('/account', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    res.render('account', { user });
  } catch (error) {
    res.status(400).send('Error loading account');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
