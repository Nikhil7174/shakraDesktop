# Crisp Interview Desktop App

A desktop application for candidates to take AI-powered interviews with built-in security monitoring. This Electron-based app provides a secure, dedicated environment for interview sessions while maintaining the same UI/UX as the web platform.

## 🚀 Features

### Interview Functionality
- **Resume Upload**: Upload and parse PDF/DOCX resumes
- **AI-Powered Questions**: Personalized questions based on resume content
- **Real-time Chat Interface**: Interactive interview experience
- **Code Execution**: Secure sandboxed JavaScript execution
- **Session Management**: Persistent interview sessions with recovery

### Security Features
- **Process Monitoring**: Real-time system process tracking
- **Blocked Application Detection**: Identifies and prevents cheating applications
- **System Tray Integration**: Runs silently in background
- **Cross-platform Support**: Windows, macOS, and Linux

### User Experience
- **Modern UI**: Built with Ant Design components
- **Responsive Design**: Adapts to different screen sizes
- **State Management**: Redux for persistent state
- **Navigation**: React Router for seamless navigation

## 🛠️ Tech Stack

- **Electron**: Desktop application framework
- **React 19**: UI library with TypeScript
- **Redux Toolkit**: State management
- **Ant Design**: UI component library
- **React Router**: Navigation
- **Monaco Editor**: Code editor
- **Axios**: HTTP client
- **Redux Persist**: State persistence

## 📦 Installation

### Prerequisites
- Node.js 18+
- npm or yarn

### Development Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

### Building for Distribution

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 🎯 Usage

### For Candidates

1. **Download and Install**: Get the desktop app for your platform
2. **Login**: Use your interview credentials
3. **Join Interview**: Enter the interview link token provided by your interviewer
4. **Upload Resume**: Upload your resume (PDF or DOCX)
5. **Complete Information**: Fill in any missing personal details
6. **Take Interview**: Answer AI-generated questions in real-time
7. **Submit Results**: Complete the interview and submit your responses

### For Administrators

1. **Create Interview Links**: Use the web admin panel to generate interview links
2. **Share Links**: Send the interview link tokens to candidates
3. **Monitor Progress**: Track interview sessions and results through the web dashboard

## 🔧 Configuration

### API Configuration
The app connects to the Crisp web API. Configure the API endpoint in:
```
src/renderer/src/constants/api.ts
```

### Security Settings
Process monitoring settings can be configured in:
```
src/main/process-monitor.ts
```

## 🏗️ Architecture

### Main Process
- **Window Management**: Creates and manages the main application window
- **Process Monitoring**: Monitors system processes for security
- **WebSocket Server**: Provides real-time security status updates
- **System Tray**: Provides system tray integration

### Renderer Process
- **React Application**: Main UI built with React and TypeScript
- **Redux Store**: Manages application state
- **Routing**: Handles navigation between different views
- **API Communication**: Communicates with the web backend

### Key Components

#### Pages
- **Login**: User authentication
- **JoinInterview**: Interview link validation and joining
- **Interview**: Main interview interface

#### Components
- **ResumeUpload**: Resume upload and processing
- **InfoCollection**: Personal information collection
- **InterviewSession**: Main interview chat interface
- **ChatMessage**: Individual chat message display

## 🔒 Security

### Process Monitoring
The app monitors system processes to detect and prevent cheating applications:
- **Blocked Apps**: ChatGPT, TeamViewer, Zoom, etc.
- **Real-time Detection**: Continuous monitoring during interviews
- **Automatic Termination**: Kills detected applications

### Data Security
- **Local Storage**: Interview data stored locally with encryption
- **API Communication**: Secure HTTPS communication
- **Token Management**: JWT tokens for authentication

## 🚀 Development

### Project Structure
```
src/
├── main/                 # Electron main process
│   ├── index.ts         # Main process entry point
│   ├── process-monitor.ts # Process monitoring
│   └── websocket-server.ts # WebSocket server
├── preload/             # Preload scripts
├── renderer/            # React application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── store/       # Redux store
│   │   ├── services/    # API services
│   │   └── types/       # TypeScript types
└── shared/              # Shared types
```

### Available Scripts
- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run typecheck`: Run TypeScript type checking
- `npm run lint`: Run ESLint
- `npm run build:win`: Build Windows executable
- `npm run build:mac`: Build macOS application
- `npm run build:linux`: Build Linux application

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and type checking
5. Submit a pull request

## 📄 License

This project is part of the Crisp Interview Platform. See the main project for licensing information.

## 🆘 Support

For support and questions:
- Check the main project documentation
- Contact the development team
- Report issues through the project repository