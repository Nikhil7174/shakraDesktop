import { useCallback } from 'react'
import axios from 'axios'
import { API_BASE_URL } from '../../constants/api'
import { FinalEvaluationPayload } from '../../../shared/types'

/**
 * Hook for submitting final evaluation to backend
 */
export const useFinalEvaluation = () => {
  const submitFinalEvaluation = useCallback(async (payload: FinalEvaluationPayload): Promise<void> => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/interview/final-evaluation`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
            'Content-Type': 'application/json'
          }
        }
      )
      
      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to submit final evaluation')
      }
      
      console.log('✅ Final evaluation submitted successfully')
    } catch (error: any) {
      console.error('Failed to submit final evaluation:', error)
      throw new Error(error.response?.data?.message || error.message || 'Failed to submit final evaluation')
    }
  }, [])

  return {
    submitFinalEvaluation
  }
}

