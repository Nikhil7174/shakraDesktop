import api from './api';


/**
 * Centralized Interview API Service
 * Single source of truth for all interview-related API calls
 */
export const interviewApi = {
  /**
   * Start a new interview session
   * @returns Complete session data including LiveKit credentials
   */
  async startInterview(candidateData: any, linkToken: string) {
    console.log('📡 [InterviewAPI] Starting interview...', {
      candidateEmail: candidateData.email,
      linkToken: linkToken.substring(0, 10) + '...'
    });

    const response = await api.post(
      '/interview/start',
      { candidateData, linkToken }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to start interview');
    }

    const session = response.data;

    console.log('✅ [InterviewAPI] Interview started successfully:', {
      sessionId: session.sessionId,
      hasToken: !!session.token,
      hasWsUrl: !!session.wsUrl,
      hasRoomName: !!session.roomName,
      questionsCount: session.questions?.length || 0,
      theoreticalCount: session.theoreticalQuestions?.length || 0,
      codingCount: session.codingQuestions?.length || 0
    });

    return session;
  },

  async uploadResume(file: File) {
    const formData = new FormData();
    formData.append('resume', file);

    const response = await api.post('/upload/resume', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      }
    });
    return response.data;
  },

  async submitAnswer(sessionId: string, questionId: string, answer: string, timeTaken: number) {
    const response = await api.post('/interview/submit-answer', {
      sessionId,
      questionId,
      answer,
      timeTaken
    });
    return response.data;
  },

  async collectMissingInfo(info: { name: string; email: string; phone: string; resumeData: any }) {
    const response = await api.post('/upload/collect-info', info);
    return response.data;
  }
};


