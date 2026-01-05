/**
 * Communication Command Center - Type Definitions
 * HIPAA-Compliant CRM/Marketing Automation Types
 * @module command-center/types
 */

/**
 * @typedef {'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'custom'} FolderType
 */

/**
 * @typedef {'low' | 'normal' | 'high' | 'urgent'} Priority
 */

/**
 * @typedef {'positive' | 'neutral' | 'negative' | 'urgent' | 'distressed'} Sentiment
 */

/**
 * @typedef {'email' | 'internal' | 'system' | 'campaign'} MessageType
 */

/**
 * @typedef {'inbound' | 'outbound'} MessageDirection
 */

/**
 * @typedef {'draft' | 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed'} MessageStatus
 */

/**
 * @typedef {'linkedin' | 'twitter' | 'facebook' | 'instagram'} SocialPlatform
 */

/**
 * @typedef {'active' | 'expired' | 'revoked' | 'error'} ConnectionStatus
 */

/**
 * @typedef {'text' | 'image' | 'video' | 'link' | 'carousel'} PostType
 */

/**
 * @typedef {'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'deleted'} PostStatus
 */

/**
 * @typedef {'email' | 'social' | 'multi_channel' | 'newsletter' | 'announcement'} CampaignType
 */

/**
 * @typedef {'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled'} CampaignStatus
 */

/**
 * @typedef {'pending' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' | 'unsubscribed'} RecipientStatus
 */

/**
 * @typedef {'open' | 'click' | 'bounce' | 'complaint' | 'unsubscribe'} TrackingEventType
 */

/**
 * @typedef {'user' | 'assistant' | 'system'} ChatRole
 */

/**
 * @typedef {'general' | 'email_draft' | 'campaign' | 'social' | 'analysis'} ConversationContext
 */

/**
 * @typedef {'faq' | 'article' | 'snippet' | 'template' | 'policy'} KnowledgeType
 */

// =============================================================================
// EMAIL TYPES
// =============================================================================

/**
 * @typedef {Object} EmailFolder
 * @property {string} id - UUID
 * @property {string} userId - Owner user ID
 * @property {string} name - Folder name
 * @property {FolderType} folderType - Type of folder
 * @property {string} [color] - Hex color
 * @property {string} [icon] - Icon name
 * @property {boolean} isSystem - Cannot be deleted
 * @property {number} sortOrder - Display order
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} EmailLabel
 * @property {string} id - UUID
 * @property {string} [organizationId] - For org-wide labels
 * @property {string} [userId] - For user-specific labels
 * @property {string} name - Label name
 * @property {string} color - Hex color
 * @property {string} [description]
 * @property {boolean} isSystem
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} EmailThread
 * @property {string} id - UUID
 * @property {string} subject - Thread subject
 * @property {string} subjectNormalized - For threading
 * @property {string[]} participantIds - User IDs in thread
 * @property {Date} lastMessageAt
 * @property {number} messageCount
 * @property {boolean} hasAttachments
 * @property {boolean} isStarred
 * @property {boolean} isArchived
 * @property {Priority} priority
 * @property {Sentiment} [sentiment] - AI-analyzed
 * @property {number} [sentimentScore]
 * @property {string} [aiSummary] - Decrypted
 * @property {string} [externalThreadId]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} EmailRecipient
 * @property {string} email
 * @property {string} [name]
 * @property {string} [userId] - If internal user
 */

/**
 * @typedef {Object} EmailRecipients
 * @property {EmailRecipient[]} to
 * @property {EmailRecipient[]} [cc]
 * @property {EmailRecipient[]} [bcc]
 */

/**
 * @typedef {Object} EmailMessage
 * @property {string} id - UUID
 * @property {string} threadId
 * @property {string} [senderId] - If internal user
 * @property {string} senderEmail - Decrypted
 * @property {string} [senderName] - Decrypted
 * @property {EmailRecipients} recipients - Decrypted
 * @property {string} subject - Decrypted
 * @property {string} [bodyHtml] - Decrypted
 * @property {string} [bodyText] - Decrypted
 * @property {MessageType} messageType
 * @property {MessageDirection} direction
 * @property {MessageStatus} status
 * @property {boolean} isRead
 * @property {Date} [readAt]
 * @property {boolean} isStarred
 * @property {boolean} isImportant
 * @property {string} [externalMessageId]
 * @property {string} [inReplyTo]
 * @property {string[]} [referencesIds]
 * @property {Date} [sentAt]
 * @property {Date} [receivedAt]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {EmailAttachment[]} [attachments]
 * @property {string[]} [folderIds]
 * @property {string[]} [labelIds]
 */

/**
 * @typedef {Object} EmailAttachment
 * @property {string} id - UUID
 * @property {string} messageId
 * @property {string} filename - Decrypted
 * @property {string} contentType
 * @property {number} sizeBytes
 * @property {string} storagePath - Decrypted
 * @property {string} [checksum]
 * @property {boolean} isInline
 * @property {string} [contentId]
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} EmailTrackingEvent
 * @property {string} id
 * @property {string} messageId
 * @property {string} [campaignId]
 * @property {TrackingEventType} eventType
 * @property {string} [userAgentHash]
 * @property {string} [ipCountry]
 * @property {string} [ipRegion]
 * @property {string} [linkUrl]
 * @property {number} [linkIndex]
 * @property {Object} [rawEventData]
 * @property {Date} createdAt
 */

/**
 * Input for composing a new email
 * @typedef {Object} ComposeEmailInput
 * @property {string} [threadId] - If replying
 * @property {EmailRecipients} recipients
 * @property {string} subject
 * @property {string} bodyHtml
 * @property {string} [bodyText]
 * @property {Priority} [priority]
 * @property {string[]} [labelIds]
 * @property {boolean} [isImportant]
 * @property {string} [inReplyTo]
 * @property {Array<{filename: string, contentType: string, data: Buffer}>} [attachments]
 */

// =============================================================================
// SOCIAL MEDIA TYPES
// =============================================================================

/**
 * @typedef {Object} SocialConnection
 * @property {string} id
 * @property {string} userId
 * @property {SocialPlatform} platform
 * @property {string} platformUserId
 * @property {string} [platformUsername]
 * @property {string} accessToken - Decrypted
 * @property {string} [refreshToken] - Decrypted
 * @property {Date} [tokenExpiresAt]
 * @property {string[]} [scopes]
 * @property {ConnectionStatus} status
 * @property {Date} [lastSyncAt]
 * @property {string} [lastError]
 * @property {Object} [profileData]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} SocialPost
 * @property {string} id
 * @property {string} userId
 * @property {string} [connectionId]
 * @property {string} [campaignId]
 * @property {string} content - Decrypted
 * @property {string} [contentPreview]
 * @property {SocialPlatform} platform
 * @property {string} [platformPostId]
 * @property {PostType} postType
 * @property {string[]} [mediaUrls] - Decrypted
 * @property {PostStatus} status
 * @property {Date} [scheduledFor]
 * @property {Date} [publishedAt]
 * @property {number} likesCount
 * @property {number} commentsCount
 * @property {number} sharesCount
 * @property {number} impressions
 * @property {number} [engagementRate]
 * @property {boolean} aiGenerated
 * @property {string} [aiPromptUsed]
 * @property {string} [originalPostId]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} SocialPostVariation
 * @property {string} id
 * @property {string} sourcePostId
 * @property {SocialPlatform} platform
 * @property {string} content - Decrypted
 * @property {'professional' | 'casual' | 'short' | 'visual_caption'} tone
 * @property {number} characterCount
 * @property {string} [aiModel]
 * @property {Date} createdAt
 */

/**
 * Input for creating a social post
 * @typedef {Object} CreateSocialPostInput
 * @property {string} content
 * @property {SocialPlatform} platform
 * @property {PostType} [postType]
 * @property {string[]} [mediaUrls]
 * @property {Date} [scheduledFor]
 * @property {boolean} [generateVariations] - AI generate for other platforms
 */

// =============================================================================
// CAMPAIGN TYPES
// =============================================================================

/**
 * @typedef {Object} SegmentCondition
 * @property {string} field - Field to filter on
 * @property {'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'within_days' | 'in' | 'not_in'} op
 * @property {any} value
 */

/**
 * @typedef {Object} SegmentCriteria
 * @property {SegmentCondition[]} conditions
 * @property {'and' | 'or'} [logic] - How to combine conditions
 */

/**
 * @typedef {Object} CampaignSegment
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {SegmentCriteria} criteria
 * @property {number} estimatedCount
 * @property {Date} [lastComputedAt]
 * @property {boolean} isActive
 * @property {boolean} isSystem
 * @property {string} [createdBy]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} ABTestConfig
 * @property {boolean} enabled
 * @property {string} testVariable - 'subject' | 'content' | 'send_time'
 * @property {number} testPercentage - % of audience for test
 * @property {number} winnerWaitHours - Hours before selecting winner
 * @property {'open_rate' | 'click_rate'} winnerMetric
 */

/**
 * @typedef {Object} Campaign
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {CampaignType} campaignType
 * @property {string[]} channels
 * @property {string} [templateId]
 * @property {string} [subjectLine]
 * @property {string} [content] - Decrypted
 * @property {string} [segmentId]
 * @property {number} recipientCount
 * @property {CampaignStatus} status
 * @property {Date} [scheduledAt]
 * @property {Date} [startedAt]
 * @property {Date} [completedAt]
 * @property {number} sendRatePerHour
 * @property {number} batchSize
 * @property {number} sentCount
 * @property {number} deliveredCount
 * @property {number} openedCount
 * @property {number} clickedCount
 * @property {number} bouncedCount
 * @property {number} unsubscribedCount
 * @property {boolean} isAbTest
 * @property {ABTestConfig} [abTestConfig]
 * @property {boolean} includesUnsubscribeLink
 * @property {boolean} physicalAddressIncluded
 * @property {string} createdBy
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} CampaignRecipient
 * @property {string} id
 * @property {string} campaignId
 * @property {string} [userId]
 * @property {string} [email] - Decrypted
 * @property {Object} [mergeFields]
 * @property {RecipientStatus} status
 * @property {Date} [sentAt]
 * @property {Date} [deliveredAt]
 * @property {Date} [openedAt]
 * @property {Date} [clickedAt]
 * @property {Date} [bouncedAt]
 * @property {'soft' | 'hard'} [bounceType]
 * @property {string} [bounceReason]
 * @property {string} [messageId]
 * @property {string} [externalMessageId]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * Campaign analytics summary
 * @typedef {Object} CampaignAnalytics
 * @property {string} campaignId
 * @property {number} totalRecipients
 * @property {number} sentCount
 * @property {number} deliveredCount
 * @property {number} openedCount
 * @property {number} uniqueOpens
 * @property {number} clickedCount
 * @property {number} uniqueClicks
 * @property {number} bouncedCount
 * @property {number} hardBounces
 * @property {number} softBounces
 * @property {number} unsubscribedCount
 * @property {number} openRate - Percentage
 * @property {number} clickRate - Percentage
 * @property {number} bounceRate - Percentage
 * @property {number} unsubscribeRate - Percentage
 * @property {Object.<string, number>} clicksByLink - Clicks per URL
 * @property {Object.<string, number>} opensByHour - Opens distribution
 * @property {Object.<string, number>} opensByDevice - Device breakdown
 */

/**
 * Input for creating a campaign
 * @typedef {Object} CreateCampaignInput
 * @property {string} name
 * @property {string} [description]
 * @property {CampaignType} campaignType
 * @property {string[]} [channels]
 * @property {string} [templateId]
 * @property {string} [subjectLine]
 * @property {string} content
 * @property {string} [segmentId]
 * @property {Date} [scheduledAt]
 * @property {number} [sendRatePerHour]
 * @property {ABTestConfig} [abTestConfig]
 */

// =============================================================================
// AI/HEALTHBOT TYPES
// =============================================================================

/**
 * @typedef {Object} HealthBotConversation
 * @property {string} id
 * @property {string} userId
 * @property {string} [title]
 * @property {ConversationContext} [contextType]
 * @property {string} [contextReferenceId]
 * @property {'active' | 'archived'} status
 * @property {number} messageCount
 * @property {Date} [lastMessageAt]
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} HealthBotMessage
 * @property {string} id
 * @property {string} conversationId
 * @property {ChatRole} role
 * @property {string} content - Decrypted
 * @property {string} [generatedContentType]
 * @property {string} [generatedContentId]
 * @property {string} [modelUsed]
 * @property {number} [tokensUsed]
 * @property {number} [latencyMs]
 * @property {number} [userRating]
 * @property {string} [userFeedback]
 * @property {boolean} [wasUsed]
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} KnowledgeBaseEntry
 * @property {string} id
 * @property {string} title
 * @property {KnowledgeType} contentType
 * @property {string} content
 * @property {string} [summary]
 * @property {number[]} [embedding]
 * @property {string} [category]
 * @property {string[]} [tags]
 * @property {string} [sourceUrl]
 * @property {string} [sourceName]
 * @property {boolean} isActive
 * @property {boolean} isVerified
 * @property {string} [verifiedBy]
 * @property {Date} [verifiedAt]
 * @property {string} [createdBy]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * PHI fields that need redaction before AI processing
 * @typedef {Object} PHIData
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {string} [email]
 * @property {string} [phone]
 * @property {string} [ssn]
 * @property {string} [dateOfBirth]
 * @property {string} [address]
 * @property {string} [medicalRecordNumber]
 * @property {string} [insuranceId]
 */

/**
 * @typedef {Object} RedactionResult
 * @property {string} redactedText
 * @property {string[]} redactedFields
 * @property {Object.<string, string>} placeholderMap - Maps placeholders to original values
 */

/**
 * Input for HealthBot chat
 * @typedef {Object} HealthBotChatInput
 * @property {string} [conversationId] - Existing conversation or create new
 * @property {string} message
 * @property {ConversationContext} [context]
 * @property {string} [contextReferenceId]
 * @property {boolean} [generateContent] - If true, generate usable content
 * @property {string} [contentType] - Type of content to generate
 */

/**
 * HealthBot response
 * @typedef {Object} HealthBotResponse
 * @property {string} conversationId
 * @property {string} messageId
 * @property {string} response
 * @property {Object} [generatedContent] - If content was generated
 * @property {string} [generatedContentType]
 * @property {Array<{title: string, content: string, relevance: number}>} [ragResults]
 * @property {number} tokensUsed
 * @property {number} latencyMs
 */

/**
 * Content generation request
 * @typedef {Object} ContentGenerationRequest
 * @property {'email_reply' | 'campaign_newsletter' | 'social_post' | 'social_variations'} type
 * @property {string} [originalContent] - Content to reply to or rework
 * @property {string} [prompt] - Additional instructions
 * @property {string} [tone] - 'professional', 'empathetic', 'casual', etc.
 * @property {SocialPlatform[]} [platforms] - For social variations
 * @property {Object} [context] - Additional context
 */

// =============================================================================
// EMAIL PROVIDER TYPES
// =============================================================================

/**
 * @typedef {'ses' | 'sendgrid' | 'mailgun' | 'smtp'} EmailProviderType
 */

/**
 * @typedef {Object} SendEmailOptions
 * @property {string} to
 * @property {string[]} [cc]
 * @property {string[]} [bcc]
 * @property {string} subject
 * @property {string} html
 * @property {string} [text]
 * @property {string} [from]
 * @property {string} [replyTo]
 * @property {Object.<string, string>} [headers]
 * @property {Array<{filename: string, content: Buffer, contentType: string}>} [attachments]
 * @property {Object} [trackingOptions]
 */

/**
 * @typedef {Object} SendEmailResult
 * @property {boolean} success
 * @property {string} [messageId]
 * @property {string} [error]
 * @property {Object} [providerResponse]
 */

/**
 * @typedef {Object} EmailProviderConfig
 * @property {EmailProviderType} type
 * @property {Object} credentials
 * @property {string} [region] - For AWS SES
 * @property {string} [domain] - For Mailgun
 * @property {string} [fromEmail]
 * @property {string} [fromName]
 */

// =============================================================================
// QUEUE TYPES
// =============================================================================

/**
 * @typedef {'email_send' | 'social_publish' | 'campaign_batch' | 'analytics_sync'} JobType
 */

/**
 * @typedef {Object} QueueJob
 * @property {string} id
 * @property {JobType} type
 * @property {Object} data
 * @property {number} [priority]
 * @property {number} [delay] - Delay in ms
 * @property {number} [attempts]
 * @property {Object} [backoff]
 */

/**
 * @typedef {Object} EmailJobData
 * @property {string} messageId
 * @property {string} [campaignId]
 * @property {string} [recipientId]
 * @property {SendEmailOptions} emailOptions
 */

/**
 * @typedef {Object} SocialPublishJobData
 * @property {string} postId
 * @property {string} connectionId
 * @property {SocialPlatform} platform
 * @property {string} content
 * @property {string[]} [mediaUrls]
 */

/**
 * @typedef {Object} CampaignBatchJobData
 * @property {string} campaignId
 * @property {string[]} recipientIds
 * @property {number} batchNumber
 */

module.exports = {
  // Export empty object since these are JSDoc types
  // Types are available via JSDoc throughout the project
};

