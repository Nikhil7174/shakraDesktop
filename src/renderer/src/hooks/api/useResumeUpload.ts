import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store';
import {
  setResumeData,
  setDetailedResumeData,
  setUploading,
  setLoading,
  setError
} from '../../store/slices/interviewSlice';
import type { ResumeData, DetailedResumeData } from '../../types';
import { interviewApi } from '../../services/interviewApi';

export const useResumeUpload = () => {
  const dispatch = useAppDispatch();
  const { resumeData, detailedResumeData, isUploading, isLoading, error } = useAppSelector(state => state.interview);

  const uploadResume = useCallback(async (file: File) => {
    try {
      dispatch(setUploading(true));
      dispatch(setError(null));

      const data = await interviewApi.uploadResume(file);

      if (data.success) {
        const resumeData: ResumeData = data.resumeData;
        const detailedResumeData: DetailedResumeData = data.detailedResumeData;

        dispatch(setResumeData(resumeData));
        dispatch(setDetailedResumeData(detailedResumeData));

        return { resumeData, detailedResumeData };
      } else {
        throw new Error('Upload failed: ' + (data.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to upload resume';
      dispatch(setError(errorMessage));
      throw new Error(errorMessage);
    } finally {
      dispatch(setUploading(false));
    }
  }, [dispatch]);

  const collectMissingInfo = useCallback(async (info: { name: string; email: string; phone: string }) => {
    try {
      dispatch(setLoading(true));
      dispatch(setError(null));



      // Ensure we have a detailedResumeData object with proper structure
      const detailedResumeDataToSend = detailedResumeData || {
        name: null,
        email: null,
        phone: null,
        text: '',
        fileName: '',
        personalInfo: {},
        experience: { internships: [], projects: [], awards: [] },
        technicalSkills: { languages: [], frameworks: [], tools: [], databases: [], other: [] }
      };

      // Use interviewApi which uses the centralized api service
      const data = await interviewApi.collectMissingInfo({
        name: info.name,
        email: info.email,
        phone: info.phone,
        resumeData: detailedResumeDataToSend
      });

      if (data.success) {
        const updatedResumeData: ResumeData = data.resumeData;
        const updatedDetailedResumeData: DetailedResumeData = data.detailedResumeData;

        dispatch(setResumeData(updatedResumeData));
        dispatch(setDetailedResumeData(updatedDetailedResumeData));

        return { resumeData: updatedResumeData, detailedResumeData: updatedDetailedResumeData };
      } else {
        throw new Error('Info collection failed: ' + (data.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Collect info error:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to collect missing info';
      dispatch(setError(errorMessage));
      throw new Error(errorMessage);
    } finally {
      dispatch(setLoading(false));
    }
  }, [dispatch, resumeData, detailedResumeData]);

  const isDataFresh = useCallback(() => {
    return !!resumeData;
  }, [resumeData]);

  const getCachedResumeData = useCallback(() => {
    return resumeData || null;
  }, [resumeData]);

  const getCachedDetailedData = useCallback(() => {
    return detailedResumeData || null;
  }, [detailedResumeData]);

  const clearResumeCache = useCallback(() => {
    // clearAllSessions();
  }, []);

  const restoreSession = useCallback(() => {
    return { resumeData, detailedResumeData };
  }, [resumeData, detailedResumeData]);

  return {
    resumeData,
    detailedResumeData,
    uploading: isUploading,
    loading: isLoading,
    error,
    uploadResume,
    collectMissingInfo,
    isDataFresh,
    getCachedResumeData,
    getCachedDetailedData,
    clearResumeCache,
    restoreSession
  };
};
