import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { supabase } from '../lib/supabase';
import aiService, { AIInsight, trackEngagement } from '../lib/aiService';
import recordingService from '../lib/recordingService';
import JitsiMeeting, { JitsiMeetingRef } from './JitsiMeeting';
import Header from './Header';
import { 
  Video, 
  Users, 
  MessageSquare, 
  TrendingUp, 
  Brain, 
  Mic, 
  MicOff, 
  Camera, 
  CameraOff, 
  Settings, 
  Share2, 
  ArrowLeft,
  Shield,
  Crown,
  Activity
} from 'lucide-react';

interface Session {
  id: string;
  title: string;
  organizer: string;
  organizer_id: string;
  start_time: string;
  end_time: string;
  attendees: number;
  engagement_score: number;
  status: string;
  type: string;
  location?: string;
  meeting_url?: string;
  description?: string;
}

interface Participant {
  id: string;
  name: string;
  avatar: string;
  engagement: number;
}

interface Question {
  id: string;
  user: string;
  question: string;
  time: string;
  sentiment: string;
}

const SessionView: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useContext(AuthContext);
  const user = auth?.user;
  
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [engagementScore, setEngagementScore] = useState(0);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isParticipating, setIsParticipating] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [isSessionLive, setIsSessionLive] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionEndTime, setSessionEndTime] = useState<Date | null>(null);
  const [newQuestion, setNewQuestion] = useState('');
  const [showQuestionInput, setShowQuestionInput] = useState(false);
  const [sessionAnalytics, setSessionAnalytics] = useState({
    totalQuestions: 0,
    avgEngagement: 0,
    participationRate: 0,
    sessionDuration: 0
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [showJitsiMeeting, setShowJitsiMeeting] = useState(false);
  const jitsiRef = useRef<JitsiMeetingRef>(null);
  
  // Role-based features
  const [isModerator, setIsModerator] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [moderatorControls, setModeratorControls] = useState({
    canMuteParticipants: false,
    canRemoveParticipants: false,
    canEndSession: false,
    canRecord: false
  });
  const [adminControls, setAdminControls] = useState({
    canViewAllAnalytics: false,
    canManageUsers: false,
    canAccessSystemMetrics: false,
    canGenerateReports: false
  });

  // Chat messages
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string;
    sender_id: string;
    sender_name: string;
    message: string;
    created_at: string;
  }>>([]);

  useEffect(() => {
    if (id) {
      fetchSessionData();
    }
  }, [id]);

  // Initialize role-based features
  useEffect(() => {
    if (user) {
      setIsModerator(user.role === 'moderator');
      setIsAdmin(user.role === 'admin');
      
      // Set moderator controls
      if (user.role === 'moderator') {
        setModeratorControls({
          canMuteParticipants: true,
          canRemoveParticipants: true,
          canEndSession: true,
          canRecord: true
        });
      }
      
      // Set admin controls
      if (user.role === 'admin') {
        setAdminControls({
          canViewAllAnalytics: true,
          canManageUsers: true,
          canAccessSystemMetrics: true,
          canGenerateReports: true
        });
      }
    }
  }, [user]);

  // Real-time subscription to session updates
  useEffect(() => {
    if (!id) return;

    const subscription = supabase
      .channel(`session-${id}`)
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'sessions',
          filter: `id=eq.${id}`
        }, 
        (payload) => {
          console.log('Session update:', payload);
          if (payload.eventType === 'UPDATE') {
            setSession(payload.new as Session);
          }
        }
      )
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'session_questions',
          filter: `session_id=eq.${id}`
        }, 
        (payload) => {
          console.log('Question update:', payload);
          if (payload.eventType === 'INSERT') {
            fetchSessionData(); // Refresh questions
          }
        }
      )
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'session_participants',
          filter: `session_id=eq.${id}`
        }, 
        (payload) => {
          console.log('Participant update:', payload);
          if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
            fetchSessionData(); // Refresh participants
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [id]);

  const fetchSessionData = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError('');

      // Fetch session data
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (sessionError) {
        console.error('Error fetching session:', sessionError);
        setError('Failed to load session');
        return;
      }

      setSession(sessionData);

      // Set session timing information
      if (sessionData.status === 'live') {
        setIsSessionLive(true);
        setSessionStartTime(new Date());
      } else if (sessionData.status === 'completed') {
        setIsSessionLive(false);
        setSessionStartTime(new Date(sessionData.date + 'T' + sessionData.start_time));
        setSessionEndTime(new Date(sessionData.date + 'T' + sessionData.end_time));
      }

      // Check if user is participating
      if (user) {
        const { data: participation } = await supabase
          .from('session_participants')
          .select('id')
          .eq('session_id', id)
          .eq('user_id', user.id)
          .single();

        setIsParticipating(!!participation);
      }

             // Fetch participants
       const { data: participantsData, error: participantsError } = await supabase
         .from('session_participants')
         .select(`
           engagement_score,
           profiles (
             name,
             avatar_url
           )
         `)
         .eq('session_id', id)
         .limit(10);

       if (participantsError) {
         console.error('Error fetching participants:', participantsError);
       } else {
         const processedParticipants = participantsData
           ?.filter(p => p.profiles)
           .map(p => ({
             id: (p.profiles as any).name,
             name: (p.profiles as any).name,
             avatar: (p.profiles as any).avatar_url || 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=50&h=50&fit=crop',
             engagement: p.engagement_score || 0
           })) || [];
         setParticipants(processedParticipants);
       }

       // Fetch questions
       const { data: questionsData, error: questionsError } = await supabase
         .from('session_questions')
         .select(`
           question,
           sentiment,
           created_at,
           profiles (
             name
           )
         `)
         .eq('session_id', id)
         .order('created_at', { ascending: false })
         .limit(10);

       if (questionsError) {
         console.error('Error fetching questions:', questionsError);
       } else {
         const processedQuestions = questionsData
           ?.filter(q => q.profiles)
           .map(q => ({
             id: q.created_at,
             user: (q.profiles as any).name,
             question: q.question,
             time: new Date(q.created_at).toLocaleTimeString('en-US', { 
               hour: '2-digit', 
               minute: '2-digit' 
             }),
             sentiment: q.sentiment || 'neutral'
           })) || [];
         setQuestions(processedQuestions);
       }

      // Set engagement score and update analytics
      setEngagementScore(sessionData.engagement_score || 0);
      updateSessionAnalytics();

      // Generate AI insights with real data
      if (user) {
        const processedQuestions = questionsData
          ?.filter(q => q.profiles)
          .map(q => ({
            id: q.created_at,
            user: (q.profiles as any).name,
            question: q.question,
            time: new Date(q.created_at).toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }),
            sentiment: q.sentiment || 'neutral'
          })) || [];

        const processedParticipants = participantsData
          ?.filter(p => p.profiles)
          .map(p => ({
            id: (p.profiles as any).name,
            name: (p.profiles as any).name,
            avatar: (p.profiles as any).avatar_url || 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=50&h=50&fit=crop',
            engagement: p.engagement_score || 0
          })) || [];

        generateAiInsights(sessionData, processedQuestions, processedParticipants);
        
        // Track session engagement
        if (sessionData.id) {
          await trackEngagement(sessionData.id, user.id, engagementScore, 'session_join', 0);
        }
      }

    } catch (error) {
      console.error('Error fetching session data:', error);
      setError('Failed to load session data');
    } finally {
      setLoading(false);
    }
  };

  const generateAiInsights = async (sessionData: any, questions: Question[], participants: Participant[]) => {
    if (!user) return;

    setLoadingInsights(true);
    try {
      // Prepare session data for AI analysis
      const analysisData = {
        ...sessionData,
        questionCount: questions.length,
        participantCount: participants.length,
        recentQuestions: questions.slice(0, 5).map(q => ({
          question: q.question,
          sentiment: q.sentiment
        })),
        avgParticipantEngagement: participants.length > 0 
          ? participants.reduce((sum, p) => sum + p.engagement, 0) / participants.length 
          : 0
      };

      // Generate AI insights with session ID for logging
      const insights = await aiService.generateSessionInsights(analysisData, user.id, sessionData.id);
      setAiInsights(insights);

      // Analyze recent questions for sentiment if any exist
      if (questions.length > 0) {
        const recentQuestion = questions[0];
        const analysis = await aiService.analyzeQuestion(recentQuestion.question, user.id);
        
        // Add insight about question sentiment if it's notable
        if (analysis.sentiment.confidence > 0.7) {
          const sentimentInsight: AIInsight = {
            type: 'content',
            message: `Recent question shows ${analysis.sentiment.sentiment} sentiment (${Math.round(analysis.sentiment.confidence * 100)}% confidence)`,
            confidence: analysis.sentiment.confidence,
            timestamp: new Date().toISOString()
          };
          setAiInsights(prev => [...prev, sentimentInsight]);
        }
      }
    } catch (error) {
      console.error('Failed to generate AI insights:', error);
      // Fallback to basic insights
      setAiInsights([
        {
          type: 'engagement',
          message: 'Session engagement tracking active',
          confidence: 0.8,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setLoadingInsights(false);
    }
  };

  const joinSession = async () => {
    if (!user || !session) return;

    try {
      const { error } = await supabase
        .from('session_participants')
        .insert({
          session_id: session.id,
          user_id: user.id
        });

      if (error) {
        console.error('Error joining session:', error);
        alert('Failed to join session');
        return;
      }

      // Track engagement when joining session
      await trackEngagement(session.id, user.id, engagementScore, 'session_join');

      setIsParticipating(true);
      
      // Show Jitsi meeting if session is live
      if (session.status === 'live') {
        setShowJitsiMeeting(true);
      }
      
      alert('Successfully joined session!');
    } catch (error) {
      console.error('Error joining session:', error);
      alert('Failed to join session');
    }
  };

  const startSession = async () => {
    if (!session || !user) return;

    try {
      const { error } = await supabase
        .from('sessions')
        .update({ 
          status: 'live',
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);

      if (error) {
        console.error('Error starting session:', error);
        alert('Failed to start session');
        return;
      }

      setIsSessionLive(true);
      setSessionStartTime(new Date());
      
      // Show Jitsi meeting when session starts
      if (isParticipating) {
        setShowJitsiMeeting(true);
      }
      
      alert('Session started successfully!');
    } catch (error) {
      console.error('Error starting session:', error);
      alert('Failed to start session');
    }
  };

  const endSession = async () => {
    if (!session || !user) return;

    try {
      const { error } = await supabase
        .from('sessions')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);

      if (error) {
        console.error('Error ending session:', error);
        alert('Failed to end session');
        return;
      }

      setIsSessionLive(false);
      setSessionEndTime(new Date());
      setShowJitsiMeeting(false);
      alert('Session ended successfully!');
    } catch (error) {
      console.error('Error ending session:', error);
      alert('Failed to end session');
    }
  };

  const askQuestion = async (questionText: string) => {
    if (!session || !user) return;

    try {
      const { error } = await supabase
        .from('session_questions')
        .insert({
          session_id: session.id,
          user_id: user.id,
          question: questionText,
          sentiment: 'neutral',
          answered: false
        });

      if (error) {
        console.error('Error asking question:', error);
        alert('Failed to ask question');
        return;
      }

      // Track engagement when asking question
      await trackEngagement(session.id, user.id, engagementScore, 'question');

      // Refresh questions list
      fetchSessionData();
      setNewQuestion('');
      setShowQuestionInput(false);
      alert('Question submitted successfully!');
    } catch (error) {
      console.error('Error asking question:', error);
      alert('Failed to ask question');
    }
  };

  const handleQuestionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newQuestion.trim()) {
      askQuestion(newQuestion.trim());
    }
  };

  const generateSessionReport = async () => {
    if (!session) return;

    try {
      const reportData = {
        sessionId: session.id,
        title: session.title,
        organizer: session.organizer,
        date: session.start_time, // Assuming start_time is the date
        duration: sessionAnalytics.sessionDuration,
        totalParticipants: participants.length,
        totalQuestions: sessionAnalytics.totalQuestions,
        avgEngagement: sessionAnalytics.avgEngagement,
        participationRate: sessionAnalytics.participationRate,
        questions: questions,
        insights: aiInsights
      };

      // Generate downloadable report
      const reportBlob = new Blob([JSON.stringify(reportData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(reportBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-report-${session.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert('Session report downloaded successfully!');
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report');
    }
  };

  const updateSessionAnalytics = () => {
    if (!session) return;

    const totalQuestions = questions.length;
    const avgEngagement = participants.length > 0 
      ? participants.reduce((sum, p) => sum + p.engagement, 0) / participants.length 
      : 0;
    const participationRate = session.attendees 
      ? (participants.length / session.attendees) * 100 
      : 0;
    
    // Calculate session duration based on start and end times
    let sessionDuration = 0;
    if (sessionStartTime && sessionEndTime) {
      sessionDuration = Math.round((sessionEndTime.getTime() - sessionStartTime.getTime()) / (1000 * 60));
    } else if (sessionStartTime) {
      sessionDuration = Math.round((new Date().getTime() - sessionStartTime.getTime()) / (1000 * 60));
    }

    setSessionAnalytics({
      totalQuestions,
      avgEngagement,
      participationRate,
      sessionDuration
    });
  };

  useEffect(() => {
    updateSessionAnalytics();
  }, [questions, participants, session]);

  const startRecording = async () => {
    if (!session) return;

    try {
      if (jitsiRef.current) {
        jitsiRef.current.startRecording();
        setIsRecording(true);
        alert('Recording started!');
      } else {
        // Fallback to service recording
        const recordingSession = await recordingService.startRecording(session.id);
        setRecordingUrl(recordingSession.recordingUrl);
        setIsRecording(true);
        alert('Recording started!');
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Failed to start recording');
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!session) return;

    try {
      if (jitsiRef.current) {
        jitsiRef.current.stopRecording();
        setIsRecording(false);
        alert('Recording stopped!');
      } else {
        // Fallback to service recording
        const completedRecording = await recordingService.stopRecording(session.id);
        setRecordingUrl(completedRecording.recordingUrl);
        setIsRecording(false);
        alert(`Recording stopped! Duration: ${completedRecording.durationMinutes} minutes`);
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      alert('Failed to stop recording');
    }
  };

  // Moderator functions
  const muteParticipant = async (participantId: string) => {
    if (!moderatorControls.canMuteParticipants) return;
    
    try {
      // Update participant mute status
      await supabase
        .from('session_participants')
        .update({ is_muted: true })
        .eq('user_id', participantId)
        .eq('session_id', id);
      
      alert('Participant muted');
    } catch (error) {
      console.error('Error muting participant:', error);
      alert('Failed to mute participant');
    }
  };

  const removeParticipant = async (participantId: string) => {
    if (!moderatorControls.canRemoveParticipants) return;
    
    try {
      // Remove participant from session
      await supabase
        .from('session_participants')
        .delete()
        .eq('user_id', participantId)
        .eq('session_id', id);
      
      alert('Participant removed from session');
    } catch (error) {
      console.error('Error removing participant:', error);
      alert('Failed to remove participant');
    }
  };

  const endSessionAsModerator = async () => {
    if (!moderatorControls.canEndSession) return;
    
    try {
      // Update session status to completed
      await supabase
        .from('sessions')
        .update({ status: 'completed' })
        .eq('id', id);
      
      alert('Session ended');
      navigate('/sessions');
    } catch (error) {
      console.error('Error ending session:', error);
      alert('Failed to end session');
    }
  };

  // Admin functions
  const generateSystemReport = async () => {
    if (!adminControls.canGenerateReports) return;
    
    try {
      // Generate comprehensive system report
      const reportData = {
        sessionId: id,
        participants: participants.length,
        questions: questions.length,
        engagementScore: engagementScore,
        duration: sessionAnalytics.sessionDuration,
        timestamp: new Date().toISOString()
      };
      
      // Save report to database
      await supabase
        .from('session_reports')
        .insert(reportData);
      
      alert('System report generated successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report');
    }
  };

  const viewSystemMetrics = async () => {
    if (!adminControls.canAccessSystemMetrics) return;
    
    try {
      // Fetch system-wide metrics
      const { data: systemMetrics } = await supabase
        .from('system_analytics')
        .select('*')
        .eq('session_id', id);
      
      console.log('System metrics:', systemMetrics);
      alert('System metrics loaded');
    } catch (error) {
      console.error('Error loading system metrics:', error);
      alert('Failed to load system metrics');
    }
  };

  // Jitsi event handlers
  const handleParticipantJoined = (participant: any) => {
    console.log('Participant joined meeting:', participant);
    // Refresh session data to update participant count
    fetchSessionData();
  };

  const handleParticipantLeft = (participant: any) => {
    console.log('Participant left meeting:', participant);
    // Refresh session data to update participant count
    fetchSessionData();
  };

  const handleMeetingStarted = () => {
    console.log('Meeting started successfully');
    setIsSessionLive(true);
  };

  const handleMeetingEnded = () => {
    console.log('Meeting ended');
    setShowJitsiMeeting(false);
    setIsSessionLive(false);
  };

  const handleChatMessage = async (message: { id?: string; sender?: { id: string; name: string }; message?: string; timestamp?: number }) => {
    console.log('Chat message received:', message);
    
    // Add new message to chatMessages state
    if (message.sender && typeof message.message === 'string') {
      const { id, sender, message: messageText, timestamp } = message;
      setChatMessages(prevMessages => [
        ...prevMessages,
        {
          id: id || `msg-${Date.now()}`,
          sender_id: sender.id,
          sender_name: sender.name,
          message: messageText, // We've already verified this is a string in the if condition
          created_at: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
        }
      ] as { id: string; sender_id: string; sender_name: string; message: string; created_at: string; }[]);
    }
    
    // Analyze sentiment of chat message using AI
    if (user && message.message) {
      try {
        const sentiment = await aiService.analyzeSentiment(message.message, user.id);
        console.log('Chat message sentiment:', sentiment);
        
        // Track engagement for chat participation
        await trackEngagement(session!.id, user.id, engagementScore + 5, 'chat');
      } catch (error) {
        console.error('Error analyzing chat sentiment:', error);
      }
    }
    
    // Refresh session data to update analytics
    fetchSessionData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Session Not Found</h2>
            <p className="text-gray-600 mb-6">The session you're looking for doesn't exist or has been removed.</p>
            <button
              onClick={() => navigate('/sessions')}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Sessions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Session Header */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{session.title}</h1>
              <p className="text-gray-600 mt-1">
                Hosted by {session.organizer} • {session.start_time} - {session.end_time}
                {isSessionLive && sessionStartTime && (
                  <span className="ml-2 text-green-600 font-medium">
                    • Live for {Math.round((new Date().getTime() - sessionStartTime.getTime()) / (1000 * 60))} min
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-600">{session.attendees}</p>
                <p className="text-sm text-gray-600">Attendees</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{engagementScore}%</p>
                <p className="text-sm text-gray-600">Engagement</p>
              </div>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                session.status === 'live' ? 'bg-green-100 text-green-800' :
                session.status === 'upcoming' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Video Area */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
              <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center mb-4">
                {showJitsiMeeting && isParticipating && session.status === 'live' ? (
                  <div className="w-full h-full">
                    <JitsiMeeting
                      ref={jitsiRef}
                      roomName={`engageai-${session.id}`}
                      displayName={user?.name || 'Anonymous'}
                      sessionId={session.id}
                      userId={user?.id || ''}
                      onParticipantJoined={handleParticipantJoined}
                      onParticipantLeft={handleParticipantLeft}
                      onChatMessageReceived={handleChatMessage}
                      onMeetingStarted={handleMeetingStarted}
                      onMeetingEnded={handleMeetingEnded}
                    />
                  </div>
                ) : session.meeting_url && session.status === 'live' && !isParticipating ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white">
                    <div className="text-4xl mb-4">🎥</div>
                    <p className="text-lg font-medium mb-2">Jitsi Meet Session</p>
                    <p className="text-sm opacity-75 mb-4">Join the session to participate in the meeting</p>
                    <button
                      onClick={joinSession}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      Join Session
                    </button>
                  </div>
                ) : session.meeting_url && session.status === 'upcoming' ? (
                  <div className="text-center text-white">
                    <div className="text-4xl mb-4">🎥</div>
                    <p className="text-lg font-medium">Jitsi Meet Session</p>
                    <p className="text-sm opacity-75 mb-4">Meeting will be available when session starts</p>
                    <div className="bg-gray-800 rounded-lg p-4 max-w-md mx-auto">
                      <p className="text-xs text-gray-300 mb-2">Room:</p>
                      <p className="text-sm font-mono text-gray-400">engageai-{session.id}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-white">
                    <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">Session Video</p>
                    <p className="text-sm opacity-75">Video will appear here when session starts</p>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center space-x-4">
                <button
                  onClick={() => {
                    if (jitsiRef.current) {
                      jitsiRef.current.toggleAudio();
                    } else {
                      setIsAudioOn(!isAudioOn);
                    }
                  }}
                  className={`p-3 rounded-full ${isAudioOn ? 'bg-gray-200 text-gray-700' : 'bg-red-500 text-white'}`}
                >
                  {isAudioOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => {
                    if (jitsiRef.current) {
                      jitsiRef.current.toggleVideo();
                    } else {
                      setIsVideoOn(!isVideoOn);
                    }
                  }}
                  className={`p-3 rounded-full ${isVideoOn ? 'bg-gray-200 text-gray-700' : 'bg-red-500 text-white'}`}
                >
                  {isVideoOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
                </button>
                
                {/* Recording Controls */}
                {user && session.organizer_id === user.id && session.status === 'live' && (
                  <>
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        className="p-3 rounded-full bg-red-500 text-white hover:bg-red-600"
                        title="Start Recording"
                      >
                        <div className="w-5 h-5 bg-white rounded-full"></div>
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="p-3 rounded-full bg-gray-500 text-white hover:bg-gray-600"
                        title="Stop Recording"
                      >
                        <div className="w-5 h-5 bg-white rounded-full"></div>
                      </button>
                    )}
                  </>
                )}
                
                <button className="p-3 rounded-full bg-gray-200 text-gray-700">
                  <Settings className="w-5 h-5" />
                </button>
                <button className="p-3 rounded-full bg-gray-200 text-gray-700">
                  <Share2 className="w-5 h-5" />
                </button>
                
                {/* Hang up button for active meetings */}
                {showJitsiMeeting && (
                  <button
                    onClick={() => {
                      if (jitsiRef.current) {
                        jitsiRef.current.hangUp();
                      }
                      setShowJitsiMeeting(false);
                    }}
                    className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700"
                    title="Leave Meeting"
                  >
                    📞
                  </button>
                )}
              </div>

              {/* Session Management Buttons */}
              <div className="mt-6 text-center space-x-4">
                {!isParticipating && session.status === 'upcoming' && (
                  <button
                    onClick={joinSession}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Join Session
                  </button>
                )}
                
                {isParticipating && session.status === 'live' && !showJitsiMeeting && (
                  <button
                    onClick={() => setShowJitsiMeeting(true)}
                    className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Enter Meeting
                  </button>
                )}
                
                {/* Organizer Controls */}
                {user && session.organizer_id === user.id && (
                  <>
                    {session.status === 'upcoming' && (
                      <button
                        onClick={startSession}
                        className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Start Session
                      </button>
                    )}
                    
                    {session.status === 'live' && (
                      <button
                        onClick={endSession}
                        className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
                      >
                        End Session
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* AI Insights */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center mb-4">
                <Brain className="w-5 h-5 text-indigo-600 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">
                  AI Insights
                  {loadingInsights && (
                    <span className="ml-2 text-sm text-gray-500">(Analyzing...)</span>
                  )}
                </h3>
              </div>
              <div className="space-y-3">
                {aiInsights.length > 0 ? (
                  aiInsights.map((insight, index) => (
                    <div key={index} className="flex items-start p-3 bg-gray-50 rounded-lg">
                      <div className={`w-2 h-2 rounded-full mt-2 mr-3 flex-shrink-0 ${
                        insight.type === 'engagement' ? 'bg-green-500' :
                        insight.type === 'participation' ? 'bg-blue-500' :
                        insight.type === 'content' ? 'bg-purple-500' :
                        'bg-orange-500'
                      }`}></div>
                      <div className="flex-1">
                        <p className="text-sm text-gray-800">{insight.message}</p>
                        <div className="flex items-center mt-1 text-xs text-gray-500">
                          <span className="capitalize">{insight.type}</span>
                          <span className="mx-1">•</span>
                          <span>{Math.round(insight.confidence * 100)}% confidence</span>
                          <span className="mx-1">•</span>
                          <span>{new Date(insight.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-4">
                    <Brain className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">
                      {loadingInsights ? 'Generating AI insights...' : 'No insights available yet'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Participants */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Participants</h3>
                <Users className="w-5 h-5 text-gray-400" />
              </div>
              <div className="space-y-3">
                {participants.map((participant) => (
                  <div key={participant.id} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <img
                        src={participant.avatar}
                        alt={participant.name}
                        className="w-8 h-8 rounded-full mr-3"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{participant.name}</p>
                        <p className="text-xs text-gray-500">{participant.engagement}% engagement</p>
                      </div>
                    </div>
                    {/* Moderator Controls */}
                    {isModerator && moderatorControls.canMuteParticipants && (
                      <div className="flex space-x-1">
                        <button
                          onClick={() => muteParticipant(participant.id)}
                          className="p-1 text-red-500 hover:text-red-700"
                          title="Mute Participant"
                        >
                          <MicOff className="w-4 h-4" />
                        </button>
                        {moderatorControls.canRemoveParticipants && (
                          <button
                            onClick={() => removeParticipant(participant.id)}
                            className="p-1 text-red-500 hover:text-red-700"
                            title="Remove Participant"
                          >
                            <Users className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Questions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Questions</h3>
                <MessageSquare className="w-5 h-5 text-gray-400" />
              </div>
              
              {/* Question Input */}
              {isParticipating && session.status === 'live' && showQuestionInput && (
                <div className="mb-4">
                  <form onSubmit={handleQuestionSubmit} className="flex space-x-2">
                    <input
                      type="text"
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      placeholder="Ask a question..."
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!newQuestion.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Ask
                    </button>
                  </form>
                </div>
              )}
              
              {/* Toggle Question Input */}
              {isParticipating && session.status === 'live' && (
                <button
                  onClick={() => setShowQuestionInput(!showQuestionInput)}
                  className="w-full mb-4 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {showQuestionInput ? 'Hide Question Input' : 'Show Question Input'}
                </button>
              )}
              
              <div className="space-y-3">
                {questions.map((question) => (
                  <div key={question.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-gray-900">{question.user}</p>
                      <span className="text-xs text-gray-500">{question.time}</span>
                    </div>
                    <p className="text-sm text-gray-600">{question.question}</p>
                    <div className="mt-2">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        question.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                        question.sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {question.sentiment}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat Messages */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Meeting Chat</h3>
                <MessageSquare className="w-5 h-5 text-gray-400" />
              </div>
              
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {chatMessages.length > 0 ? (
                  chatMessages.map((message) => (
                    <div key={message.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-gray-900">{message.sender_name}</p>
                        <span className="text-xs text-gray-500">
                          {new Date(message.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{message.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No chat messages yet</p>
                )}
              </div>
            </div>

                          {/* Session Analytics */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Session Analytics</h3>
                  <TrendingUp className="w-5 h-5 text-gray-400" />
                </div>
                
                {/* Recording URL Display */}
                {recordingUrl && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-red-500 rounded-full mr-2 animate-pulse"></div>
                        <span className="text-sm font-medium text-green-800">Recording Available</span>
                      </div>
                      <a
                        href={recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-green-600 hover:text-green-800 underline"
                      >
                        View Recording
                      </a>
                    </div>
                  </div>
                )}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Questions:</span>
                  <span className="text-sm font-medium">{sessionAnalytics.totalQuestions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Avg Engagement:</span>
                  <span className="text-sm font-medium">{Math.round(sessionAnalytics.avgEngagement)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Participation Rate:</span>
                  <span className="text-sm font-medium">{Math.round(sessionAnalytics.participationRate)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Duration:</span>
                  <span className="text-sm font-medium">{sessionAnalytics.sessionDuration} min</span>
                </div>
              </div>
              
              {/* Report Generation */}
              {session.status === 'completed' && (
                <button
                  onClick={generateSessionReport}
                  className="w-full mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
                >
                  Generate Report
                </button>
              )}
            </div>

            {/* Moderator Controls */}
            {isModerator && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Moderator Controls</h3>
                  <Shield className="w-5 h-5 text-orange-500" />
                </div>
                <div className="space-y-3">
                  <button
                    onClick={endSessionAsModerator}
                    disabled={session.status !== 'live'}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    End Session
                  </button>
                  <div className="text-xs text-gray-500">
                    <p>• Mute participants using controls above</p>
                    <p>• Remove participants if needed</p>
                    <p>• End session when complete</p>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Controls */}
            {isAdmin && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Admin Controls</h3>
                  <Crown className="w-5 h-5 text-purple-500" />
                </div>
                <div className="space-y-3">
                  <button
                    onClick={generateSystemReport}
                    className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                  >
                    Generate System Report
                  </button>
                  <button
                    onClick={viewSystemMetrics}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    View System Metrics
                  </button>
                  <div className="text-xs text-gray-500">
                    <p>• Access system-wide analytics</p>
                    <p>• Generate comprehensive reports</p>
                    <p>• Monitor platform performance</p>
                  </div>
                </div>
              </div>
            )}

            {/* Real-time Metrics */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Real-time Metrics</h3>
                <Activity className="w-5 h-5 text-green-500" />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Active Participants:</span>
                  <span className="text-sm font-medium text-green-600">{participants.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Questions Asked:</span>
                  <span className="text-sm font-medium text-blue-600">{questions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Session Duration:</span>
                  <span className="text-sm font-medium text-purple-600">
                    {isSessionLive && sessionStartTime 
                      ? `${Math.round((new Date().getTime() - sessionStartTime.getTime()) / (1000 * 60))} min`
                      : '0 min'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Engagement Score:</span>
                  <span className="text-sm font-medium text-orange-600">{engagementScore}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SessionView;