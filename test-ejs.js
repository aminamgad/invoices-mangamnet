import ejs from 'ejs';
import fs from 'fs';

try {
    const template = fs.readFileSync('views/invoices/new.ejs', 'utf8');
    console.log('Template loaded successfully');
    
    // Try to compile with more detailed error reporting
    const compiled = ejs.compile(template, {
        filename: 'views/invoices/new.ejs',
        debug: true
    });
    
    console.log('EJS template compiled successfully');
} catch (error) {
    console.error('EJS compilation error:', error.message);
    console.error('Error details:', error);
} 