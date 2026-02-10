// src/types/index.ts
export type UserType = 'interviewee' | 'candidate';

export interface User {
  id: number;
  email: string;
  fullName: string;
  userType: 'candidate';
  phone?: string;
  company?: string;
  createdAt?: string;
  lastLogin?: string;
}

export interface InterviewLink {
  id: number;
  token: string;
  title: string;
  description?: string;
  expiryDate?: string;
  maxAttempts: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  totalAttempts?: number;
  url: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  isSynced: boolean; // Indicates if auth state has been synced with backend/Clerk on startup
}

export interface ResumeData {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  text: string;
  fileName: string;
}

export interface DetailedResumeData {
  // Personal Information
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;

  // Education
  college?: string | null;
  batch?: string | null;
  branch?: string | null;
  degree?: string | null;
  cgpa?: string | null;

  // Experience
  internships?: Array<{
    company: string;
    role: string;
    duration: string;
    description?: string;
  }>;

  projects?: Array<{
    name: string;
    description: string;
    technologies: string[];
    duration?: string;
  }>;

  // Skills
  technicalSkills?: string[];
  programmingLanguages?: string[];
  frameworks?: string[];
  tools?: string[];

  // Achievements
  awards?: string[];
  certifications?: string[];

  // Additional
  summary?: string;
  linkedin?: string | null;
  github?: string | null;
}

export interface InterviewState {
  // Resume data
  resumeData: ResumeData | null;
  detailedResumeData: DetailedResumeData | null;

  // Loading states
  uploading: boolean;
  loading: boolean;
  startingInterview: boolean;
  submittingAnswer: boolean;

  // Interview session
  currentSession: InterviewSession | null;
  chatMessages: ChatMessage[];

  // Error handling
  error: string | null;
}

// Flattened session structure - no more confusing nesting
export interface StoredSession {
  // Session metadata
  sessionId: string;
  timestamp: number;
  lastActivity: number;
  sessionType: 'new' | 'interrupted' | 'completed';

  // Resume data
  resumeData?: ResumeData;
  detailedResumeData?: DetailedResumeData;

  // Interview data (flattened from currentSession)
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  questions?: Question[]; // Optional - session might be created before questions are generated
  answers?: Answer[]; // Optional - new sessions might not have answers yet
  startTime: Date;
  endTime?: Date;
  duration?: number;
  score?: number;
  summary?: string;

  // Chat messages
  chatMessages?: ChatMessage[]; // Optional - new sessions might not have chat messages yet

  // Additional metadata
  candidateId?: string;
  success?: boolean;
  message?: string;
}

export interface SessionSummary {
  timeAway: number; // minutes
  questionsAnswered: number;
  totalQuestions: number;
  sessionDuration: number; // minutes
  startTime: number;
}

export interface InterviewSession {
  id?: string; // Optional for backward compatibility
  sessionId: string; // Added to match server response
  interviewLinkId?: number; // Link to interview_links table
  candidateId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  questions: Question[];
  answers: Answer[];
  startTime: Date;
  endTime?: Date;
  duration?: number;
  score?: number;
  summary?: string;
  // Additional fields from server response
  success?: boolean;
  message?: string;
  timestamp?: number;
  lastActivity?: number;
  chatMessages?: ChatMessage[];

  // Enhanced session tracking
  currentStep?: 'upload' | 'info' | 'interview' | 'completed';
  lastUserInteraction?: number; // Timestamp of last user action
  isActivelyInProgress?: boolean; // True if user is currently taking the interview
  sessionPhase?: 'setup' | 'active' | 'paused' | 'completed'; // More granular than status
}

// Add new interfaces for multiple choice
export interface MultipleChoiceOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  question: string;
  type: 'behavioral' | 'technical' | 'situational' | 'coding';
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number; // seconds
  askedAt?: Date;
  // Multiple choice fields (for MCQ questions)
  options?: MultipleChoiceOption[];
  correctAnswerId?: string;
  // Coding fields (for coding questions)
  language?: 'javascript' | 'typescript' | 'python' | 'java' | 'cpp';
  initialCode?: string;
  expectedOutput?: string;
  testCases?: Array<{
    input: string;
    expectedOutput: string;
  }>;
  instructions?: string;
}

export interface Answer {
  questionId: string;
  answer: string; // For MCQ: selected option text, For coding: code description
  selectedOptionId?: string; // For MCQ questions
  code?: string; // For coding questions
  answeredAt: Date;
  timeTaken: number; // seconds
  score?: number;
  feedback?: string;
  isCorrect?: boolean;
  testResults?: Array<{
    passed: boolean;
    input: string;
    expectedOutput: string;
    actualOutput: string;
  }>;
}

export interface Evaluation {
  score: number;
  feedback: string;
}

export interface AnswerResult {
  success: boolean;
  isCorrect?: boolean;
  correctAnswerId?: string;
  evaluation?: Evaluation;
  isComplete: boolean;
  nextQuestion?: Question;
  message: string;
}

export interface FinalResults {
  sessionId: string;
  finalScore: number;
  summary: string;
  answers: Array<{
    question: string;
    answer: string;
    score: number;
    timeTaken: number;
  }>;
  duration: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string | Date; // Support both ISO string and Date object
  metadata?: any;
}

// Security-related types (from existing Electron app)
export interface SecurityStatus {
  connected: boolean;
  blockedApps: string[];
  timestamp: number;
  error?: string;
  blockedAndKilled?: string[];
  message?: string;
}

export interface ProcessStatsData {
  totalProcesses: number;
  blockedProcesses: number;
  killedProcesses: number;
  lastScanTime: number;
  scanDuration: number;
}

