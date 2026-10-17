# School ERP - Intermediate School Management System

A complete school management system built with **Node.js + Express + MySQL + EJS**.

## Features

| Module | Admin | Teacher | Student |
|--------|-------|---------|---------|
| Dashboard with charts | ✅ | ✅ | ✅ |
| Student Management | ✅ CRUD | View | View own |
| Teacher Management | ✅ CRUD | - | - |
| Class & Subject Mgmt | ✅ | - | - |
| Attendance Marking | ✅ | ✅ | View own |
| Attendance Reports | ✅ | ✅ | - |
| Fee Structure Setup | ✅ | - | - |
| Fee Collection | ✅ | - | - |
| Fee Receipt PDF | ✅ | - | ✅ |
| **Fee Reminder Notice PDF** | ✅ | - | - |
| Pending Fee List | ✅ | - | - |
| Exam Management | ✅ | - | - |
| Results Entry | ✅ | ✅ | - |
| **Report Card PDF** | ✅ | ✅ | ✅ |
| Notices/Announcements | ✅ | View | View |

---

## Tech Stack

- **Runtime:** Node.js v18+
- **Framework:** Express.js
- **Database:** MySQL 8+
- **Template Engine:** EJS with express-ejs-layouts
- **Auth:** express-session + bcryptjs
- **PDF:** PDFKit
- **Charts:** Chart.js

---

## Setup Instructions

### 1. Install MySQL & Create Database

```sql
-- Open MySQL and run:
mysql -u root -p < database.sql
```

Or open MySQL Workbench and import `database.sql`.

### 2. Configure Environment

Edit `.env` file:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=school_erp
PORT=3000
SESSION_SECRET=your_secret_key
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Open: **http://localhost:3000**

---

## Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@school.com | admin123 |

> Teachers and students are created via Admin panel. Default password for created accounts is `teacher123` or `student123`.

---

## Project Structure

```
school-erp/
├── app.js               # Express app entry point
├── database.sql         # MySQL schema + seed data
├── .env                 # Environment variables
├── config/
│   └── db.js            # MySQL connection pool
├── middleware/
│   └── auth.js          # Role-based auth middleware
├── routes/
│   ├── auth.js          # Login/logout
│   ├── admin.js         # All admin routes
│   ├── teacher.js       # Teacher routes
│   └── student.js       # Student routes
├── views/
│   ├── layouts/         # EJS layouts (main + auth)
│   ├── auth/            # Login page
│   ├── admin/           # All admin views
│   ├── teacher/         # Teacher views
│   └── student/         # Student views
└── public/
    ├── css/style.css    # Main stylesheet
    └── js/main.js       # Client-side JS
```

---

## PDF Features

- **Fee Receipt**: Auto-generated after payment with receipt number
- **Fee Reminder Notice**: Professional A4 notice with pending fee table
- **Report Card**: Full PDF report card with grades and signature blocks

---

## Adding More Data (Quick Start)

1. Login as admin
2. Go to **Classes** → Add a class (e.g., "Grade 9", Section "A")
3. Go to **Subjects** → Add subjects for the class
4. Go to **Teachers** → Add a teacher (assign class & subjects)
5. Go to **Students** → Add students (assign to class)
6. Go to **Fees** → Add fee structure for the class
7. Go to **Attendance** → Mark daily attendance
8. Go to **Results** → Create exam → Enter marks → Print report cards
