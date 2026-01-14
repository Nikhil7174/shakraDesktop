import axios from 'axios';
import { API_BASE_URL } from '../constants/api';

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

    const response = await axios.post(
      `${API_BASE_URL}/interview/start`,
      { candidateData, linkToken },
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken')}`
        }
      }
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
  }
};


