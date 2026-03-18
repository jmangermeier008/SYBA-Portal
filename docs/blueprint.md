# **App Name**: Home Run Hub

## Core Features:

- Firebase Email/Password Authentication: Secure user registration and login functionality using Firebase Authentication for email and password.
- Automatic Firestore User Profile Generation: Upon user signup, automatically create a new Firestore document in a 'users' collection, storing the user's uid, email, and assigning a default role of 'Parent'.
- Role-Based Dashboard Navigation: Implement a routing system that directs users to a specific dashboard (Parent, Coach, or Admin) immediately after successful login, based on their role stored in Firestore.
- Admin User Role Management Interface: A basic administrative interface allowing designated 'Admin' users to view user accounts and update their roles (Parent, Coach, Admin).
- Progressive Web App (PWA) Functionality: Initialize the application with core PWA capabilities, allowing users to install the app on their devices and offering basic offline access.
- AI-Powered Practice Drill Generator Tool: A generative AI tool for coaches to receive customized practice drill suggestions based on selected inputs like player age group, skill level, or practice focus.
- 'My Family' Player Management for Parents: A Parent Dashboard component allowing users to add new player profiles with first_name, last_name, date_of_birth, and parent_uid to a Firestore 'Players' collection. Includes a secure document upload component using Firebase Storage for PIAA clearances or birth certificates, linking file paths to player documents. Firebase Storage and Firestore Security Rules will ensure only the associated parent or an Admin can access this data.
- 'Season Enrollment' Workflow for Parents: Allows parents to select a child from their 'My Family' list and enroll them in an upcoming season. The form captures season-specific data such as jersey_size and division. Upon submission, a new document is created in a Firestore 'Enrollments' collection, including a 'payment_status' field initially set to 'pending', and the parent is redirected to a Stripe Checkout page to complete the payment for the registration fee.
- Stripe Checkout Session Creation: A Next.js API route that generates a Stripe Checkout Session when a parent submits an enrollment. The fee amount is dynamically set based on the selected division (e.g., T-Ball: $50, Coach Pitch: $75). Stripe secret keys are accessed securely via environment variables.
- Stripe Payment Confirmation Webhook: A secure webhook endpoint to listen for the 'checkout.session.completed' event from Stripe. When the webhook confirms payment, it automatically updates the corresponding Enrollments document in Firestore, changing 'payment_status' from 'pending' to 'paid'. Stripe secret keys are accessed securely via environment variables.
- Parent Team Schedule & RSVP: Parents can view a mobile-friendly list of their child's team's upcoming games and RSVP with 'Attending', 'Not Attending', or 'Maybe'.
- Coach Team Schedule & RSVP Headcount: Coaches can view their team's schedule with a real-time headcount of player availability based on parent RSVPs.
- Real-time Team Chat: A real-time chat component for team members using Firestore listeners to facilitate communication.
- Coach Broadcast Notifications: Coaches can send urgent updates, like field changes, to the team via Firebase Cloud Messaging push notifications using a 'Broadcast' button in the chat.

## Style Guidelines:

- Primary Color: A vibrant medium blue (#2E7ECC) to evoke team spirit and freshness, reflecting the clear sky on game day.
- Background Color: A soft, heavily desaturated light blue (#ECF2F7) providing a clean, airy canvas that complements the primary color.
- Accent Color: A bright cyan-green (#66D9D9) chosen for its refreshing analogy to the primary blue, used to highlight key interactive elements and calls to action.
- Headline and Body Font: 'Inter' (sans-serif), for its modern, clean, and highly readable characteristics, suitable for conveying clear information in a youth sports context.
- Utilize simple, easily recognizable icons that align with sports, user management, and common app functions, maintaining a clean and friendly aesthetic.
- Implement a responsive and intuitive layout designed for accessibility across various devices, ensuring ease of navigation for parents, coaches, and administrators.
- Incorporate subtle and smooth transitions for state changes and navigation, enhancing the user experience without being distracting.