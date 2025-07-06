import express from 'express';
import User from '../models/User.js';

const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  res.render('auth/login');
});

// Login POST
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username, isActive: true });
    if (!user || !(await user.comparePassword(password))) {
      req.flash('error', 'اسم المستخدم أو كلمة المرور غير صحيحة');
      return res.redirect('/auth/login');
    }
    
    req.session.user = {
      id: user._id,
      username: user.username,
      role: user.role,
      permissions: user.permissions
    };
    
    req.flash('success', 'تم تسجيل الدخول بنجاح');
    res.redirect('/dashboard');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تسجيل الدخول');
    res.redirect('/auth/login');
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
});

export default router;