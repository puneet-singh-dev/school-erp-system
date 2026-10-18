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

---

## 🚀 How to Deploy Online (Free)

> ⚠️ **Note on GitHub Pages:** GitHub Pages is strictly for static HTML/CSS websites. Because this system is a full-stack **Node.js + Express backend with a MySQL database**, it cannot run directly on GitHub Pages (which only renders static README files). 
> Use one of the free platforms below:

### Option A: Railway (Easiest - 1 Click Node.js + MySQL)
1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo** → select `school-erp-system`.
3. In the same project, click **+ New** → **Database** → **MySQL**.
4. Railway will automatically link your database URL (`DATABASE_URL`).
5. Your School ERP is now live with a public URL!

### Option B: Render.com (Free Web Service)
1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Click **New +** → **Web Service** → Connect your `school-erp-system` repo.
3. Settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node app.js`
4. In **Environment Variables**, add:
   - `DATABASE_URL`: `mysql://username:password@host:port/dbname` (from a free MySQL provider like [Aiven.io](https://aiven.io), [Clever-Cloud.com](https://www.clever-cloud.com), or Railway)
   - `SESSION_SECRET`: any random string
   - `SCHOOL_NAME`: `Shri Amrit Lal Smarak School And College`
   - `SCHOOL_PHONE`: `9129914501`
5. Click **Deploy Web Service**! The app will automatically initialize all database tables and the admin account on first boot.

