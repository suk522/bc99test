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
app.use('/attached_assets', express.static('attached_assets'));

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
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
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
  res.render('home', { user, path: '/home' });
});

app.get('/activity', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  res.render('activity', { user, path: '/activity' });
});

app.get('/wallet', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  const transactions = await Transaction.find({ userId: user._id }).sort({ date: -1 });
  res.render('wallet', { user, transactions, path: '/wallet' });
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

app.get('/wallet/balance', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    res.json({ balance: user.balance });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching balance' });
  }
});

app.post('/wallet/withdraw', isAuthenticated, async (req, res) => {
  try {
    const { amount, accountNumber, ifscCode, holderName } = req.body;
    const user = await User.findById(req.session.user._id);

    if (user.balance < amount) {
      return res.status(400).send('Insufficient balance');
    }

    if (!user.bankDetails?.accountNumber && accountNumber) {
      user.bankDetails = { accountNumber, ifscCode, holderName };
      await user.save();
    }

    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    
    const withdrawal = new Withdrawal({
      userId: user._id,
      orderNumber,
      amount,
      bankDetails: user.bankDetails,
      status: 'pending'
    });
    await withdrawal.save();

    const transaction = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount,
      status: 'pending'
    });
    await transaction.save();

    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing withdrawal');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { path: req.path });
});

app.get('/register', (req, res) => {
  res.render('register', { path: req.path });
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
  res.render('admin-login', { query: req.query, path: req.path });
});

app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  console.log('Admin login attempt - password:', password);

  if (username === 'admin' && password === '123') {
    req.session.isAdmin = true;
    console.log('Setting admin session:', req.session.isAdmin);
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/admin-login?error=1');
      }
      res.redirect('/admin');
    });
  } else {
    res.redirect('/admin-login?error=1');
  }
});

app.get('/admin', isAdmin, async (req, res) => {
  console.log('Admin session check:', req.session.isAdmin);
  const users = await User.find();
  const withdrawals = await Withdrawal.find().populate('userId');
  res.render('admin', { users, withdrawals, path: req.path });
});

app.post('/admin/withdrawal/:id/:action', isAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    const withdrawal = await Withdrawal.findById(id);
    const user = await User.findById(withdrawal.userId);

    if (action === 'approve') {
      withdrawal.status = 'approved';
      if (user.balance >= withdrawal.amount) {
        user.balance -= withdrawal.amount;
        await user.save();
      }
    } else if (action === 'reject') {
      withdrawal.status = 'rejected';
    }
    
    await withdrawal.save();
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error processing withdrawal action');
  }
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
    res.render('account', { user, path: req.path });
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