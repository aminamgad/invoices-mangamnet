import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import flash from 'express-flash';
import methodOverride from 'method-override';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import clientRoutes from './routes/clients.js';
import distributorRoutes from './routes/distributors.js';
import companyRoutes from './routes/companies.js';
import fileRoutes from './routes/files.js';
import invoiceRoutes from './routes/invoices.js';
import commissionTierRoutes from './routes/commission-tiers.js';
import reportRoutes from './routes/reports.js';

// Import middleware
import { requireAuth, requireAdmin, loadUserPermissions } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/arabic-invoice-system')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(flash());

// Load user permissions middleware
app.use(loadUserPermissions);

// Global variables
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/auth', authRoutes);
app.use('/dashboard', requireAuth, dashboardRoutes);
app.use('/clients', requireAuth, clientRoutes);
app.use('/distributors', requireAuth, requireAdmin, distributorRoutes);
app.use('/companies', requireAuth, companyRoutes);
app.use('/files', requireAuth, fileRoutes);
app.use('/invoices', requireAuth, invoiceRoutes);
app.use('/commission-tiers', requireAuth, requireAdmin, commissionTierRoutes);
app.use('/reports', requireAuth, reportRoutes);

// Home route
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/auth/login');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});