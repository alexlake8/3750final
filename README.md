Battleship API

Project Overview:
The Battleship API is a backend service that allows users to play a multiplayer version of Battleship through HTTP requests. Players can create accounts, join games, take turns firing shots, and track their performance. The project focuses on implementing real game logic, including turn order, move validation, and win conditions.

The application is built using:
Node.js and Express.js for the server and routing
A structured data layer for managing players and games
Deployment on Render

Base URL:
https://three750final.onrender.com/api

Frontend Site:
https://three750final-1.onrender.com

Endpoints:
POST /reset – Reset all data

POST /players – Create a player

GET /players/{id}/stats – View player stats

POST /games – Create a game

POST /games/{id}/join – Join a game

GET /games/{id} – View game state

POST /games/{id}/fire – Make a move

Team Members:
Alex Lake
Jude Slade

AI Tools Used:
ChatGPT
Claude

Roles and Contributions:
Alex Lake: Managing Render web service, Postgresql database, and Github repo
Jude Slade: Backend Architecture
ChatGPT/Claude: Writing program files
