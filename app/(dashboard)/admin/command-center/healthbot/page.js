'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Bot, Send, User, Sparkles, Copy, ThumbsUp, ThumbsDown,
  RefreshCw, Settings, MessageSquare, FileText, Mail,
  Share2, Loader2, Trash2, Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const SUGGESTED_PROMPTS = [
  { icon: Mail, text: 'Help me draft a patient follow-up email', context: 'email_draft' },
  { icon: FileText, text: 'Generate a newsletter about diabetes prevention', context: 'campaign' },
  { icon: Share2, text: 'Create social media posts about telehealth', context: 'social' },
  { icon: MessageSquare, text: 'Analyze the sentiment of a patient message', context: 'analysis' }
];

const MOCK_CONVERSATIONS = [
  { id: '1', title: 'Email draft assistance', preview: 'Help me draft a professional...', time: '2h ago' },
  { id: '2', title: 'Campaign newsletter', preview: 'Generate a newsletter about...', time: 'Yesterday' },
  { id: '3', title: 'Social media content', preview: 'Create variations for...', time: '3 days ago' }
];

export default function HealthBotPage() {
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (content) => {
    if (!content.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: generateMockResponse(content),
        timestamp: new Date(),
        tokensUsed: Math.floor(Math.random() * 500) + 200
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const generateMockResponse = (input) => {
    const inputLower = input.toLowerCase();
    
    if (inputLower.includes('email') || inputLower.includes('draft')) {
      return `I'd be happy to help you draft a professional email! Here's a template you can customize:

**Subject: Follow-up on Your Recent Visit**

Dear [Patient Name],

Thank you for choosing Docta for your healthcare needs. We hope your recent visit with Dr. [Provider Name] was helpful.

As discussed during your appointment, please remember to:
- Take your prescribed medications as directed
- Schedule a follow-up appointment in [timeframe]
- Contact us if you experience any concerning symptoms

We're here to support your health journey. Don't hesitate to reach out if you have any questions.

Best regards,
The Docta Care Team

---
*Would you like me to adjust the tone, add specific details, or create variations of this email?*`;
    }
    
    if (inputLower.includes('newsletter') || inputLower.includes('campaign')) {
      return `Here's a draft newsletter about health awareness:

# 📧 January Health Newsletter

## Stay Healthy This Winter Season

**Dear Valued Patients,**

As we enter the new year, we want to share some important health tips to help you stay well this winter:

### 🏥 Preventive Care Reminders
- Schedule your annual wellness check
- Get your flu shot if you haven't already
- Review your medications with your provider

### 💪 Healthy Habits
- Stay active even in cold weather
- Maintain a balanced diet rich in vitamins
- Get adequate sleep (7-9 hours for adults)

### 📱 Telehealth Services
Did you know you can consult with our providers from the comfort of your home? Our telehealth services make healthcare accessible anytime.

**[Schedule Your Appointment Today]**

Stay healthy,
The Docta Team

---
*Would you like me to adjust the content, add more sections, or create versions for different patient segments?*`;
    }
    
    if (inputLower.includes('social') || inputLower.includes('post')) {
      return `Here are social media post variations for your content:

**LinkedIn (Professional):**
"At Docta, we're committed to making healthcare accessible for everyone. Our telehealth platform enables patients to connect with qualified healthcare providers from anywhere. Schedule your virtual consultation today and experience the future of healthcare. #Telehealth #HealthcareInnovation #PatientCare"

**Twitter/X (Concise):**
"🏥 Healthcare, reimagined. Connect with doctors from anywhere with our telehealth services. Your health, your schedule. #Telehealth #DigitalHealth"

**Facebook (Engaging):**
"Say goodbye to waiting rooms! 👋 With Docta's telehealth services, you can see a doctor from your couch, office, or wherever you are. It's healthcare that fits YOUR life. Click to learn more and schedule your first virtual visit! 💻🩺"

**Instagram (Visual Caption):**
"Healthcare from anywhere 🌍✨ Your wellness journey doesn't have to wait. Book your telehealth appointment today! Link in bio 👆 #TelehealthLife #ModernMedicine #HealthcareHeroes #WellnessJourney #DoctaHealth"

---
*Want me to adjust the tone, add hashtags, or create more variations?*`;
    }
    
    if (inputLower.includes('sentiment') || inputLower.includes('analyze')) {
      return `I can analyze message sentiment! Please share the patient message you'd like me to analyze, and I'll provide:

📊 **Sentiment Analysis Includes:**
- Overall sentiment (positive/neutral/negative/urgent/distressed)
- Sentiment score (0-1 scale)
- Urgency level assessment
- Key emotional indicators
- Suggested response approach

Simply paste the message content and I'll analyze it for you.

---
*Note: All PHI is automatically redacted before processing to ensure HIPAA compliance.*`;
    }

    return `I'm HealthBot, your AI assistant for healthcare communications! I can help you with:

🔹 **Email Drafting** - Compose professional, empathetic patient communications
🔹 **Campaign Content** - Create newsletters and marketing emails
🔹 **Social Media** - Generate platform-specific content variations
🔹 **Sentiment Analysis** - Analyze patient messages for urgency and tone
🔹 **Reply Suggestions** - Get AI-powered response recommendations

How can I assist you today?`;
  };

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content);
    toast({ title: 'Copied to clipboard' });
  };

  const handleNewConversation = () => {
    setSelectedConversation(null);
    setMessages([]);
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <Button onClick={handleNewConversation} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>
        
        <div className="flex-1 overflow-auto p-2">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedConversation(conv.id)}
              className={cn(
                'w-full text-left p-3 rounded-lg mb-1 transition-colors',
                'hover:bg-accent',
                selectedConversation === conv.id && 'bg-accent'
              )}
            >
              <p className="font-medium text-sm truncate">{conv.title}</p>
              <p className="text-xs text-muted-foreground truncate">{conv.preview}</p>
              <p className="text-xs text-muted-foreground mt-1">{conv.time}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold">HealthBot</h2>
              <p className="text-xs text-muted-foreground">AI-powered healthcare assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5" />
              Online
            </Badge>
            <Button variant="ghost" size="icon">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-4">
                <Sparkles className="w-10 h-10 text-violet-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">How can I help you today?</h3>
              <p className="text-muted-foreground max-w-md mb-8">
                I can help draft emails, create campaigns, generate social content, and analyze patient messages.
              </p>
              
              <div className="grid grid-cols-2 gap-3 max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => handleSendMessage(prompt.text)}
                    className="flex items-start gap-3 p-4 rounded-xl border border-border hover:bg-accent transition-colors text-left"
                  >
                    <prompt.icon className="w-5 h-5 text-violet-500 mt-0.5" />
                    <span className="text-sm">{prompt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' && 'flex-row-reverse'
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    message.role === 'assistant' 
                      ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                      : 'bg-primary'
                  )}>
                    {message.role === 'assistant' ? (
                      <Bot className="w-4 h-4 text-white" />
                    ) : (
                      <User className="w-4 h-4 text-white" />
                    )}
                  </div>
                  
                  <div className={cn(
                    'flex-1 max-w-[80%]',
                    message.role === 'user' && 'flex flex-col items-end'
                  )}>
                    <Card className={cn(
                      message.role === 'user' && 'bg-primary text-primary-foreground'
                    )}>
                      <CardContent className="p-4">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          {message.content.split('\n').map((line, i) => (
                            <p key={i} className="mb-2 last:mb-0 whitespace-pre-wrap">
                              {line}
                            </p>
                          ))}
                        </div>
                        
                        {message.role === 'assistant' && (
                          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopy(message.content)}
                            >
                              <Copy className="w-3 h-3 mr-1" />
                              Copy
                            </Button>
                            <Button variant="ghost" size="sm">
                              <ThumbsUp className="w-3 h-3 mr-1" />
                              Helpful
                            </Button>
                            <Button variant="ghost" size="sm">
                              <ThumbsDown className="w-3 h-3 mr-1" />
                            </Button>
                            {message.tokensUsed && (
                              <span className="text-xs text-muted-foreground ml-auto">
                                {message.tokensUsed} tokens
                              </span>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <span className="text-xs text-muted-foreground mt-1">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <Card className="flex-1 max-w-[80%]">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                        <span className="text-sm text-muted-foreground">HealthBot is thinking...</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border">
          <div className="flex items-end gap-3">
            <Textarea
              placeholder="Ask HealthBot anything..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(inputValue);
                }
              }}
              rows={1}
              className="flex-1 min-h-[44px] max-h-32 resize-none"
            />
            <Button
              onClick={() => handleSendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="h-[44px] px-4"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            HealthBot automatically redacts PHI before processing. All conversations are encrypted.
          </p>
        </div>
      </div>
    </div>
  );
}

