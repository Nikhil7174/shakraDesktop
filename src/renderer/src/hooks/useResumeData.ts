import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from './useAuth';
import { useAppDispatch } from '../store';
import { setResumeData as setReduxResumeData, setDetailedResumeData as setReduxDetailedResumeData } from '../store/slices/interviewSlice';
import { logout as logoutAction } from '../store/slices/authSlice';

export const useResumeData = () => {
  const { token, isAuthenticated } = useAuth();
  const dispatch = useAppDispatch();
  const [resumeData, setResumeData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResumeData = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setResumeData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await api.get('/auth/resume');

      if (response.data.success) {
        const fetchedResumeData = response.data.resumeData;
        setResumeData(fetchedResumeData);
        // Also update Redux state so InterviewChat can access it
        if (fetchedResumeData) {
          dispatch(setReduxResumeData(fetchedResumeData));
          // If we have detailed resume data, set that too
          if (fetchedResumeData.detailedResumeData) {
            dispatch(setReduxDetailedResumeData(fetchedResumeData.detailedResumeData));
          }
        }
      } else {
        setResumeData(null);
      }
    } catch (error: any) {
      console.error('Failed to fetch resume data:', error);
      // Handle 401 errors by logging out
      if (error.response?.status === 401) {
        dispatch(logoutAction());
      }
      setError(error.response?.data?.message || 'Failed to fetch resume data');
      setResumeData(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token, dispatch]);

  const updateResumeData = useCallback(async (newResumeData: any) => {
    if (!isAuthenticated || !token) {
      throw new Error('User not authenticated');
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await api.post('/auth/resume', {
        resumeData: newResumeData
      });

      if (response.data.success) {
        setResumeData(newResumeData);
        // Also update Redux state
        dispatch(setReduxResumeData(newResumeData));
        if (newResumeData.detailedResumeData) {
          dispatch(setReduxDetailedResumeData(newResumeData.detailedResumeData));
        }
        return true;
      } else {
        throw new Error('Failed to update resume data');
      }
    } catch (error: any) {
      console.error('Failed to update resume data:', error);
      // Handle 401 errors by logging out
      if (error.response?.status === 401) {
        dispatch(logoutAction());
      }
      setError(error.response?.data?.message || 'Failed to update resume data');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token, dispatch]);

  useEffect(() => {
    fetchResumeData();
  }, [fetchResumeData]);

  return {
    resumeData,
    loading,
    error,
    fetchResumeData,
    updateResumeData,
    hasResume: !!resumeData
  };
};

