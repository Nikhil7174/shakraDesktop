import { useCallback } from 'react'
import api from '../../services/api'
import { FinalEvaluationPayload } from '../../../../shared/types'

/**
 * Hook for submitting final evaluation to backend
 */
export const useFinalEvaluation = () => {
  const submitFinalEvaluation = useCallback(async (payload: FinalEvaluationPayload): Promise<void> => {
    try {
      const response = await api.post(
        '/interview/final-evaluation',
        payload
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

