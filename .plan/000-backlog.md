# Prioritized Backlog

Current queue:

(empty)

## DONE (Examples)

- [V] Add a css preprocessor and use it for styling. Instead of regular css, use scss.
| plan:.plan/017-2026-08-18-scss-preprocessor.md

- [V] There should be no hard coded values in the application - replace all toaster messages with constants that will be in a relevant utils file
| plan:.plan/016-2026-08-18-toast-message-constants.md

- [V] Sort and UI fixes: 1. Add a sort option in the Reports route. I want an option to sort according to the grade, from hight to low or vice versa, Also sorting by date from latest to oldest and vice versa. 2. Add an animation to the cards when they appear in the /reports/:id route. 3. In dark mode, the date picker icon, remains black, should be white.
| plan:.plan/015-2026-08-17-sort-and-ui-fixes.md

- [V] support different environments and not only localhost, which is developemnt. I want .env.staging and .env.production to be supported as well. Ideploy to gitub pages and leave instruction on how to fill the other .env files for the application to work there too and npt only on localhost.
| plan:.plan/014-2026-08-14-multi-env-deployment.md

- [V] Add a reports history route where I can view and download all previous reports for the user. It should also have a date filter to display reports for a specific date, and filters of "Job title", "Interview type" and "Experience level" same as appear in the "practice" route. add links for all existing routes to the application header. Add a UI indication for the selected link that we are currently on.
| plan:.plan/013-2026-08-14-reports-history.md

- [V] In login route also add the show password option
| plan:.plan/012-2026-08-14-login-show-password.md

- [V] Add light mode/ dark mode switch in the header
| plan:.plan/011-2026-08-14-theme-toggle.md

- [V] UI fixes: 1. In User settings: Add a show password option for the password field. 2. Add animations for the cards in 'home' and 'practice' routes. 3. change the scrollbars to be thinner with colors that fit the theme.
| plan:.plan/010-2026-08-14-ui-fixes.md

- [V] In the frontend Use pinia store with relevant files. Make all the api calls happen through the store files. add error handling with toaster messages for api error notifications. The UI components should call store files and these should handle the api calls.
| plan:.plan/009-2026-08-13-pinia-store-api-calls.md

- [V] In home page, I want the titles: "What it does", "How it works" and "Key features" to be collapsible accordions. Also, Add a favicon to the application
| plan:.plan/008-2026-08-13-home-accordions-favicon.md

- [V] Add authentication. a. Use HTTPS for all authentication requests.
b. Never store or transmit plaintext passwords.
c. Passwords should be hashed on the server (e.g., bcrypt or Argon2).
d. Validate credentials securely.
2. Authentication flow

Typical flow:

a. User enters email and password.
b. Frontend sends credentials over HTTPS.
c. Backend verifies credentials.
d. Backend creates a session or issues a JWT/access token.
e. Frontend stores authentication information securely.
f. Future requests include authentication automatically.   3. Token/session storage

Preferred for web apps:

a. HttpOnly, Secure cookies
b. JavaScript cannot access them.
c. Protects against token theft through XSS.
d. Often used with server-side sessions or JWTs.

If using JWTs:

a. Access token
b. Refresh token
c. Short expiration for access tokens
d. Refresh flow when expired

 I want that in the header there will be a new option called: 'settings' with an appropriate icon. when clicked it will open a menu with 'User settings' option and 'Logout', each with an icon next to them. Logout will clear the user data in the frontend and set him as logged out in the backend. The User settings will open a page where you can edit the user name, email, password and optionally upload a profile image. The uploaded image will be displayed as the profile image in the header with a round border around it. Unsigned users will not see the home page when first entering the application, they will be redirected to the login/signup route (you need to add a new route), that will have all the fields needed for the login/signup process.
| plan:.plan/007-2026-08-13-authentication.md

- [V] Create a home page for the application. The home page will have a short explanation of the applications' purpose: It will have 3 sections: the first explaining what the application does, below it a section of How it works and underneath it 'key features' list (with icons), The home page should be the start page of the application after logging in. The 'AI Interview Simulator' in the header will be a link for the home page. add another route for the interview paractice (which is currently the only page). Make sure the home page answers the following questions:
What is this application?
Who is it for?
What problem does it solve?
How does it work?
What should I do next?
| plan:.plan/006-2026-08-12-home-page.md

- [V] Add pagination for the reports history data
| plan:.plan/018-2026-09-06-reports-history-pagination.md

- [V] Add gamification element. Add messages such as: a You're awesome!,  Good Job!, etc'... as alerts for users that are successfull in answering the interview questions, but not after each question, do it periodically. The messages will appear in a nice modal with a appropriate icons and animations.
| plan:.plan/019-2026-09-07-gamification-encouragement.md

- [V] Add a summary file/s in the project that will summerize everything in the application: starting from the applications' purpose and functionallity to UI, UX, architecture, data, services, store, connections, authentication, authorization, etc'... You should split the code explanations to backend and frontend. You can make 2 separate files, one for backend and one for frontend. Every architectural choise made should be explained throughtly. 
In addition, display a diagram from the backend schema, so that it will be clear how the tables are connected with each other (this could be added in a separate file). I want everything explained in such a way that if someone would explain a recruiter about the system, after reading these files, he/she will be hired for the job. 
| plan:.plan/020-2026-09-08-project-summary-docs.md
