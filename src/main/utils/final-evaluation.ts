import { InterviewSession, FinalEvaluationPayload, ConversationMessage, Evaluation, CodingProblem, CodeAnalysis } from '../../shared/types'

/**
 * Creates a comprehensive final evaluation payload from an interview session
 * This uses the centralized conversation history from InterviewOrchestrator
 */
export function createFinalEvaluationPayload(
  session: InterviewSession,
  fullConversationHistory: ConversationMessage[],
  codeAnalysisConversations: Array<{
    problemId: string
    problem: CodingProblem
    conversation: ConversationMessage[]
    finalCode?: string
    timeComplexity?: string
    spaceComplexity?: string
    codeAnalysisHistory: CodeAnalysis[]
    submittedAt?: Date
    evaluation?: {
      score: number
      feedback: string
      testResults?: Array<{
        passed: boolean
        input: string
        expectedOutput: string
        actualOutput: string
      }>
    }
  }>,
  evaluations: Evaluation[]
): FinalEvaluationPayload {
  console.log('📊 [FinalEvaluation] Creating payload:')
  console.log('📊 [FinalEvaluation] - Full conversation history:', fullConversationHistory.length, 'messages')
  console.log('📊 [FinalEvaluation] - Code analysis conversations:', codeAnalysisConversations.length, 'problems')
  codeAnalysisConversations.forEach((conv, idx) => {
    console.log(`📊 [FinalEvaluation]   Problem ${idx + 1}: ${conv.conversation.length} messages`)
  })
  
  // Extract theoretical and coding messages from the full history
  const theoreticalMessages = fullConversationHistory.filter(
    msg => msg.metadata.section === 'theoretical'
  )
  const codingMessages = fullConversationHistory.filter(
    msg => msg.metadata.section === 'coding'
  )
  
  console.log('📊 [FinalEvaluation] - Theoretical messages:', theoreticalMessages.length)
  console.log('📊 [FinalEvaluation] - Coding messages:', codingMessages.length)
  
  // Use the full conversation history directly (already sorted chronologically)
  const allConversations: ConversationMessage[] = fullConversationHistory
  
  console.log('📊 [FinalEvaluation] Total conversation history:', allConversations.length, 'messages')
  console.log('📊 [FinalEvaluation] Message breakdown by type:')
  const typeCounts = allConversations.reduce((acc, msg) => {
    acc[msg.metadata.type] = (acc[msg.metadata.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('📊 [FinalEvaluation]', JSON.stringify(typeCounts, null, 2))

  // Validate session has required properties
  if (!session || !session.id) {
    throw new Error('Invalid session: session or session.id is missing')
  }
  
  if (!session.questions) {
    console.warn('⚠️ [FinalEvaluation] Session has no questions array, using empty array')
  }
  if (!session.codingProblems) {
    console.warn('⚠️ [FinalEvaluation] Session has no codingProblems array, using empty array')
  }
  
  // Organize theoretical conversations by question
  const questions = session.questions || []
  const codingProblems = session.codingProblems || []
  
  const theoreticalConversations = questions.map(question => {
    const questionConversations = theoreticalMessages.filter(
      msg => msg.metadata.questionId === question.id
    )
    const questionEvaluations = evaluations.filter(
      evaluation => evaluation.questionId === question.id
    )
    const totalScore = questionEvaluations.length > 0
      ? questionEvaluations.reduce((sum, e) => sum + e.score, 0) / questionEvaluations.length
      : 0

    return {
      questionId: question.id,
      question: question.question,
      conversation: questionConversations,
      evaluations: questionEvaluations,
      totalScore
    }
  })

  // Calculate theoretical section metrics
  const theoreticalScores = theoreticalConversations.map(c => c.totalScore)
  const theoreticalOverallScore = theoreticalScores.length > 0
    ? theoreticalScores.reduce((sum, score) => sum + score, 0) / theoreticalScores.length
    : 0

  // Organize coding conversations
  const codingConversations = codeAnalysisConversations.map(conv => ({
    problemId: conv.problemId,
    problem: conv.problem,
    conversation: conv.conversation,
    finalCode: conv.finalCode,
    timeComplexity: conv.timeComplexity,
    spaceComplexity: conv.spaceComplexity,
    codeAnalysisHistory: conv.codeAnalysisHistory,
    submittedAt: conv.submittedAt ? conv.submittedAt.toISOString() : undefined,
    evaluation: conv.evaluation
  }))

  // Calculate coding section metrics
  const codingScores = codingConversations
    .filter(c => c.evaluation)
    .map(c => c.evaluation!.score)
  const codingOverallScore = codingScores.length > 0
    ? codingScores.reduce((sum, score) => sum + score, 0) / codingScores.length
    : 0

  // Calculate total score (weighted average: 60% theoretical, 40% coding)
  const totalScore = theoreticalScores.length > 0 && codingScores.length > 0
    ? (theoreticalOverallScore * 0.6 + codingOverallScore * 0.4)
    : theoreticalScores.length > 0
    ? theoreticalOverallScore
    : codingOverallScore

  // Count metadata
  const hintRequestCount = allConversations.filter(
    msg => msg.metadata.type === 'hint'
  ).length
  const clarificationRequestCount = allConversations.filter(
    msg => msg.metadata.type === 'clarification'
  ).length
  const followUpCount = allConversations.filter(
    msg => msg.metadata.type === 'followup'
  ).length

  // Calculate average times (simplified - would need actual timing data)
  const averageTimePerQuestion = 0 // TODO: Calculate from actual timing data
  const averageTimePerCodingProblem = 0 // TODO: Calculate from actual timing data

  // Generate strengths and areas for improvement
  const strengths: string[] = []
  const areasForImprovement: string[] = []

  if (totalScore >= 90) {
    strengths.push('Excellent technical knowledge', 'Strong problem-solving skills', 'Clear communication')
  } else if (totalScore >= 80) {
    strengths.push('Good understanding of core concepts', 'Solid technical foundation')
    areasForImprovement.push('Focus on advanced topics', 'Improve time management')
  } else if (totalScore >= 60) {
    strengths.push('Willingness to learn and improve')
    areasForImprovement.push('Review fundamental concepts', 'Practice more technical questions')
  } else {
    areasForImprovement.push('Review fundamental concepts', 'Practice more technical questions', 'Improve problem-solving approach')
  }

  if (hintRequestCount > 5) {
    areasForImprovement.push('Work on independent problem-solving')
  }
  if (clarificationRequestCount > 3) {
    areasForImprovement.push('Improve understanding of problem requirements')
  }

  // Generate overall feedback
  const overallFeedback = totalScore >= 90
    ? `Outstanding performance! You demonstrated excellent technical knowledge and problem-solving skills throughout the interview.`
    : totalScore >= 80
    ? `Great job! You showed strong technical knowledge and a good understanding of the concepts covered.`
    : totalScore >= 60
    ? `Good effort! You demonstrated a solid foundation with room for improvement in some areas.`
    : `You completed the interview. Focus on strengthening your fundamentals and practicing more technical questions.`

  // Calculate duration
  const duration = session.endTime && session.startTime
    ? session.endTime.getTime() - session.startTime.getTime()
    : 0

  return {
    sessionId: session.id,
    candidateId: session.candidateId || 'unknown',
    interviewLinkId: (session as any).interviewLinkId,
    startTime: session.startTime ? session.startTime.toISOString() : new Date().toISOString(),
    endTime: session.endTime ? session.endTime.toISOString() : new Date().toISOString(),
    duration,
    fullConversationHistory: allConversations,
    theoreticalSection: {
      questions: questions,
      conversations: theoreticalConversations,
      overallScore: Math.round(theoreticalOverallScore),
      totalQuestions: questions.length
    },
    codingSection: {
      problems: codingProblems,
      conversations: codingConversations,
      overallScore: Math.round(codingOverallScore),
      totalProblems: codingProblems.length
    },
    totalScore: Math.round(totalScore),
    strengths,
    areasForImprovement,
    overallFeedback,
    hintRequestCount,
    clarificationRequestCount,
    followUpCount,
    averageTimePerQuestion,
    averageTimePerCodingProblem
  }
}

