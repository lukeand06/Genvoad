@echo off
REM Quick Setup Script for Genovad (Windows)
echo Setting up Genovad...

REM Check if .env exists, if not copy from example
if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo WARNING: Please edit .env file with your configuration!
)

REM Install dependencies
echo Installing dependencies...
call npm install

echo.
echo Setup complete!
echo.
echo Next steps:
echo 1. Edit .env file with your MongoDB URI and JWT secret
echo 2. Start MongoDB if using local installation
echo 3. Run 'npm run dev' to start the development server
echo 4. Open http://localhost:5000 in your browser
echo.
pause
