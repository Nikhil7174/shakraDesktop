// src/hooks/useUserSelection.ts
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { setActiveUserType } from '../store/slices/uiSlice';
import { setUserType } from '../store/slices/userSlice';
import { addToJourney } from '../store/slices/sessionSlice';
import type { UserType } from '../types';

export const useUserSelection = () => {
  const dispatch = useAppDispatch();
  const { activeUserType } = useAppSelector((state) => state.ui);
  const { userType } = useAppSelector((state) => state.user);

  const selectUserType = useCallback((type: UserType) => {
    dispatch(setActiveUserType(type));
    dispatch(setUserType(type));
    dispatch(addToJourney(`selected_${type}`));
    
    // Smooth scroll to next section
    setTimeout(() => {
      const element = document.getElementById('common-content');
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, [dispatch]);

  const resetSelection = useCallback(() => {
    dispatch(setActiveUserType(null));
  }, [dispatch]);

  return {
    activeUserType,
    userType,
    selectUserType,
    resetSelection,
  };
};