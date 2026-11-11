# CampusFix — Smart Campus Management System

A premium, responsive FSD lab project built with **HTML, CSS and JavaScript**.

## Features
- Student and Admin demo login
- Dashboard with complaint statistics and resolution chart
- Submit campus complaints with category, location, priority and description
- Search and filter complaints
- Admin can update complaint status (Pending → In Progress → Resolved)
- Lost & Found community board
- Light / dark mode
- Responsive layout for mobile and desktop
- LocalStorage persistence (data remains in the same browser)

## Run in VS Code
1. Extract `CampusFix.zip`.
2. Open the `CampusFix` folder in Visual Studio Code.
3. Install the **Live Server** extension (Ritwick Dey).
4. Right-click `index.html` → **Open with Live Server**.
5. The app opens in your browser.

You can also double-click `index.html`, but Live Server is recommended.

## Demo login
Password for both accounts: `campus123`

| Role | Email |
|---|---|
| Student | student@campusfix.demo |
| Admin | admin@campusfix.demo |

## Suggested demo flow for the external
1. Login as Student.
2. Show the dashboard statistics and recent complaints.
3. Open Complaints → New complaint.
4. Submit: title `Fan not working`, category `Electrical`, location `Block A - Room 101`, priority `High`, and a short description.
5. Sign out and login as Admin.
6. Open Complaints → View details for the new complaint.
7. Change status to `In Progress`, save, then change to `Resolved`.
8. Show the updated dashboard.
9. Open Lost & Found and post an item.
10. Toggle dark mode and resize the browser to show responsive design.

## Project structure
```
CampusFix/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Important technical note
This is a **frontend-only academic prototype**. Login is a demo role switch, and data is stored in browser LocalStorage. It is not secure authentication and does not sync between different computers. A production version would need a backend API, database, password hashing, server-side validation and role-based authorization.

## Viva one-line summary
“CampusFix is a responsive campus issue-management web application. Students can report and track complaints and post lost/found items, while admins can update complaint statuses. I used HTML for structure, CSS for responsive UI, JavaScript for DOM interaction and validation, and LocalStorage for browser-side persistence.”
