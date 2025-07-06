import express from 'express';
import File from '../models/File.js';
import Company from '../models/Company.js';
import { upload } from '../middleware/upload.js';
import { requireModuleAccess, requirePermission } from '../middleware/auth.js';

const router = express.Router();

// List files
router.get('/', requireModuleAccess('files'), async (req, res) => {
  try {
    let query = {};
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const files = await File.find(query)
      .populate('company', 'name')
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
    res.render('files/index', { 
      files,
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل الملفات');
    res.render('files/index', { 
      files: [],
      userPermissions: req.userPermissionLevel || {}
    });
  }
});

// New file form
router.get('/new', requirePermission('files', 'create'), async (req, res) => {
  try {
    const companies = await Company.find().sort({ name: 1 });
    res.render('files/new', { companies });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل الشركات');
    res.redirect('/files');
  }
});

// Create file
router.post('/', requirePermission('files', 'create'), upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'يجب اختيار ملف PDF');
      return res.redirect('/files/new');
    }
    
    const { fileName, company, status, notes } = req.body;
    
    const file = new File({
      fileName,
      company,
      status,
      notes,
      pdfPath: req.file.filename,
      createdBy: req.session.user.id
    });
    
    await file.save();
    req.flash('success', 'تم إضافة الملف بنجاح');
    res.redirect('/files');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إضافة الملف');
    res.redirect('/files/new');
  }
});

// Edit file form
router.get('/:id/edit', requirePermission('files', 'update'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this file
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const file = await File.findOne(query);
    const companies = await Company.find().sort({ name: 1 });
    
    if (!file) {
      req.flash('error', 'الملف غير موجود أو ليس لديك صلاحية للوصول إليه');
      return res.redirect('/files');
    }
    
    res.render('files/edit', { file, companies });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات الملف');
    res.redirect('/files');
  }
});

// Update file
router.put('/:id', requirePermission('files', 'update'), async (req, res) => {
  try {
    const { fileName, company, status, notes } = req.body;
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this file
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await File.updateOne(query, {
      fileName,
      company,
      status,
      notes
    });
    
    if (result.matchedCount === 0) {
      req.flash('error', 'الملف غير موجود أو ليس لديك صلاحية لتعديله');
      return res.redirect('/files');
    }
    
    req.flash('success', 'تم تحديث بيانات الملف بنجاح');
    res.redirect('/files');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث بيانات الملف');
    res.redirect('/files');
  }
});

// Delete file
router.delete('/:id', requirePermission('files', 'delete'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this file
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await File.deleteOne(query);
    
    if (result.deletedCount === 0) {
      req.flash('error', 'الملف غير موجود أو ليس لديك صلاحية لحذفه');
      return res.redirect('/files');
    }
    
    req.flash('success', 'تم حذف الملف بنجاح');
    res.redirect('/files');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء حذف الملف');
    res.redirect('/files');
  }
});

export default router;