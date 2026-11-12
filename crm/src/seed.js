'use strict';
/** داده‌ی آزمایشی (Demo). فقط روی دیتابیس بدون شرکت/مخاطب اجرا می‌شود. گذرواژه‌ی همه‌ی کاربران دمو: Demo12345 */
const { openDb, tx } = require('./db');
const { hashPassword } = require('./auth');
const db = openDb();
if (db.prepare('SELECT COUNT(*) n FROM companies').get().n || db.prepare('SELECT COUNT(*) n FROM contacts').get().n) {
  console.error('دیتابیس قبلاً داده دارد؛ seed اجرا نشد.'); process.exit(1);
}
const day = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
const iso = (off) => new Date(Date.now() + off * 86400000).toISOString();
tx(db, () => {
  const pw = hashPassword('Demo12345');
  const u = (username, name, role) => {
    const ex = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    return ex ? ex.id : Number(db.prepare('INSERT INTO users(username,name,role,password_hash) VALUES (?,?,?,?)').run(username, name, role, pw).lastInsertRowid);
  };
  const admin = u('admin', 'مدیر سیستم', 'admin');
  const mgr = u('manager', 'مریم احمدی', 'manager');
  const s1 = u('ali', 'علی رضایی', 'sales'), s2 = u('sara', 'سارا کریمی', 'sales');
  const owners = [s1, s2, mgr];
  const co = (name, industry, city, size, o) => Number(db.prepare('INSERT INTO companies(name,industry,city,size,owner_id,website) VALUES (?,?,?,?,?,?)').run(name, industry, city, size, o, 'https://example.com').lastInsertRowid);
  const comps = [co('آریا صنعت', 'تولیدی', 'تهران', 120, s1), co('پارس‌نت', 'فناوری اطلاعات', 'تهران', 45, s2), co('گلبرگ تجارت', 'بازرگانی', 'اصفهان', 30, s1), co('نوین درمان', 'سلامت', 'شیراز', 80, mgr), co('سپهر ساختمان', 'پیمانکاری', 'مشهد', 200, s2)];
  const names = [['محمد', 'حسینی'], ['زهرا', 'موسوی'], ['حسین', 'نوری'], ['فاطمه', 'صادقی'], ['رضا', 'کاظمی'], ['نرگس', 'جعفری'], ['امیر', 'اکبری'], ['مینا', 'رحیمی']];
  const contacts = names.map(([f, l], i) => Number(db.prepare('INSERT INTO contacts(first_name,last_name,email,mobile,position,company_id,owner_id,source) VALUES (?,?,?,?,?,?,?,?)')
    .run(f, l, `user${i + 1}@example.com`, `0912000${1000 + i}`, ['مدیرعامل', 'مدیر خرید', 'مدیر فنی', 'مدیر مالی'][i % 4], comps[i % comps.length], owners[i % 3], ['وب‌سایت', 'معرفی', 'نمایشگاه', 'تماس سرد'][i % 4]).lastInsertRowid));
  const prods = [['مشاوره پیاده‌سازی', 'SVC-01', 25000000], ['لایسنس سالانه', 'LIC-01', 60000000], ['پشتیبانی ویژه', 'SUP-01', 15000000]]
    .map(([n, s, p]) => Number(db.prepare('INSERT INTO products(name,sku,price) VALUES (?,?,?)').run(n, s, p).lastInsertRowid));
  const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], prob = { new: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
  for (let i = 0; i < 14; i++) {
    const st = stages[i % 6];
    const id = Number(db.prepare('INSERT INTO deals(title,value,stage,probability,expected_close,closed_at,contact_id,company_id,owner_id,lost_reason) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(`پروژه ${['آلفا', 'بتا', 'گاما', 'دلتا', 'امگا', 'سیگما', 'لامبدا'][i % 7]} ${i + 1}`, (i + 2) * 40000000, st, prob[st], day(i * 4 - 10),
        st === 'won' || st === 'lost' ? iso(-(i % 5) * 20) : null, contacts[i % contacts.length], comps[i % comps.length], owners[i % 3], st === 'lost' ? 'بودجه کافی نبود' : null).lastInsertRowid);
    db.prepare('INSERT INTO activities(entity_type,entity_id,type,body,user_id) VALUES (?,?,?,?,?)').run('deal', id, 'system', 'رکورد ایجاد شد', owners[i % 3]);
    db.prepare('INSERT INTO deal_items(deal_id,product_id,name,qty,price) VALUES (?,?,?,?,?)').run(id, prods[0], 'مشاوره پیاده‌سازی', 1, (i + 2) * 40000000);
  }
  ['وب‌سایت', 'معرفی', 'نمایشگاه', 'شبکه اجتماعی'].forEach((src, i) => {
    ['new', 'contacted', 'qualified'].forEach((st, j) => db.prepare('INSERT INTO leads(first_name,last_name,company_name,email,phone,source,status,score,owner_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(['سعید', 'لیلا', 'کامران', 'شیما'][i], ['یوسفی', 'فرهادی', 'مرادی', 'بهرامی'][j % 4], `شرکت نمونه ${i * 3 + j + 1}`, `lead${i}${j}@example.com`, `0935000${i}${j}00`, src, st, 30 + i * 10 + j * 5, owners[(i + j) % 3]));
  });
  [['پیگیری تماس با مشتری', 'call', 'high', -2], ['ارسال پیش‌فاکتور', 'email', 'normal', 0], ['جلسه معرفی محصول', 'meeting', 'normal', 3], ['بازبینی قرارداد', 'todo', 'low', 7], ['تماس پیگیری پیشنهاد', 'call', 'high', -5]]
    .forEach(([t, type, pr, off], i) => db.prepare('INSERT INTO tasks(title,type,priority,due_date,assignee_id,created_by,related_type,related_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(t, type, pr, day(off), owners[i % 3], admin, 'contact', contacts[i % contacts.length]));
});
console.log('داده‌ی نمونه ساخته شد. کاربران: admin(گذرواژه‌ی مدیر اولیه) / manager / ali / sara  با گذرواژه Demo12345');
