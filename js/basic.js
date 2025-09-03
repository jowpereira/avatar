// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var avatarSynthesizer
var peerConnection
var useTcpForWebRTC = false
var previousAnimationFrameTimestamp = 0;
var chatHistory = [];

// NEW: Teaching mode state
var isTeachingMode = false;
var teachingState = {
    isActive: false,
    currentTopic: '',
    currentSubtask: '',
    progress: { topicIndex: 0, subtaskIndex: 0, totalTopics: 0, totalSubtasks: 0 }
};

// Logger
const log = msg => {
    document.getElementById('logging').innerHTML += msg + '<br>'
}

// Chat History Management
window.addToChatHistory = (message, isUser = false) => {
    const timestamp = new Date().toLocaleTimeString();
    chatHistory.push({
        message,
        isUser,
        timestamp
    });
    
    const chatHistoryElement = document.getElementById('chatHistory');
    if (chatHistoryElement) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
        messageDiv.innerHTML = `
            <div class="message-content">${message}</div>
            <div class="message-time">${timestamp}</div>
        `;
        chatHistoryElement.appendChild(messageDiv);
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }
}

window.clearChatHistory = () => {
    chatHistory = [];
    const chatHistoryElement = document.getElementById('chatHistory');
    if (chatHistoryElement) {
        chatHistoryElement.innerHTML = '';
    }
}

window.toggleConfiguration = () => {
    const config = document.getElementById('configuration');
    if (config) {
        config.style.display = config.style.display === 'none' ? 'block' : 'none';
    }
}

window.toggleLogs = () => {
    const logs = document.getElementById('logging');
    if (logs) {
        logs.style.display = logs.style.display === 'none' ? 'block' : 'none';
    }
}

// Enter key support for chat input
document.addEventListener('DOMContentLoaded', () => {
    const userPrompt = document.getElementById('userPrompt');
    if (userPrompt) {
        userPrompt.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.askAI();
            }
        });
    }
});

// ============ NEW TEACHING MODE FUNCTIONS ============

// Toggle between chat and teaching mode
window.toggleMode = () => {
    isTeachingMode = !isTeachingMode;
    const modeText = document.getElementById('modeText');
    const chatSection = document.getElementById('chatSection');
    const teachingSection = document.getElementById('teachingSection');
    
    if (isTeachingMode) {
        modeText.textContent = '🎓 Teaching Mode';
        chatSection.style.display = 'none';
        teachingSection.style.display = 'block';
    } else {
        modeText.textContent = '💬 Chat Mode';
        chatSection.style.display = 'block';
        teachingSection.style.display = 'none';
        // Stop teaching if active
        if (teachingState.isActive) {
            window.stopTeaching();
        }
    }
};

// Start teaching session
window.startTeaching = async () => {
    try {
        const resp = await fetch('/api/teaching/start', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to start teaching');
        
        const data = await resp.json();
        teachingState.isActive = true;
        
        // Update UI
        document.getElementById('startTeaching').disabled = true;
        document.getElementById('nextLesson').disabled = false;
        document.getElementById('stopTeaching').disabled = false;
        document.getElementById('askTeachingQuestion').disabled = false;
        document.getElementById('lessonProgress').style.display = 'block';
        document.getElementById('teachingChat').style.display = 'block';
        
        // Load first lesson
        await window.loadCurrentLesson();
        
        log('🎓 Sessão de ensino iniciada!');
    } catch (err) {
        log('Erro ao iniciar ensino: ' + err.message);
    }
};

// Stop teaching session
window.stopTeaching = async () => {
    try {
        const resp = await fetch('/api/teaching/stop', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to stop teaching');
        
        teachingState.isActive = false;
        
        // Update UI
        document.getElementById('startTeaching').disabled = false;
        document.getElementById('nextLesson').disabled = true;
        document.getElementById('stopTeaching').disabled = true;
        document.getElementById('askTeachingQuestion').disabled = true;
        document.getElementById('lessonProgress').style.display = 'none';
        document.getElementById('lessonContent').style.display = 'none';
        document.getElementById('teachingChat').style.display = 'none';
        
        log('🛑 Sessão de ensino finalizada!');
    } catch (err) {
        log('Erro ao parar ensino: ' + err.message);
    }
};

// Load current lesson content
window.loadCurrentLesson = async () => {
    try {
        const resp = await fetch('/api/teaching/lesson', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to load lesson');
        
        const data = await resp.json();
        if (data.success) {
            const lesson = data.lesson;
            
            // Update progress
            teachingState.currentTopic = lesson.topicTitle;
            teachingState.currentSubtask = lesson.subtaskTitle;
            teachingState.progress = lesson.progress;
            
            // Update UI
            document.getElementById('currentTopic').textContent = 
                `${lesson.topicTitle} - ${lesson.subtaskTitle}`;
            document.getElementById('progressText').textContent = 
                `${lesson.progress.topicIndex + 1}/${lesson.progress.totalTopics} - ${lesson.progress.subtaskIndex + 1}/${lesson.progress.totalSubtasks}`;
            
            const progressPercent = ((lesson.progress.topicIndex * 10 + lesson.progress.subtaskIndex + 1) / (lesson.progress.totalTopics * 10)) * 100;
            document.getElementById('progressFill').style.width = `${progressPercent}%`;
            
            // Show lesson content
            const lessonContent = document.getElementById('lessonContent');
            lessonContent.innerHTML = `
                <div class="lesson-text">
                    <h4>${lesson.subtaskTitle}</h4>
                    <p>${lesson.content}</p>
                </div>
            `;
            lessonContent.style.display = 'block';
            
            // Make avatar speak the lesson
            await window.speakLesson(lesson.content);
            
        }
    } catch (err) {
        log('Erro ao carregar lição: ' + err.message);
    }
};

// Make avatar speak lesson content
window.speakLesson = async (content) => {
    try {
        if (!avatarSynthesizer) {
            log('Avatar não está disponível para falar');
            return;
        }
        
        // Update spokenText for subtitle compatibility
        const spokenEl = document.getElementById('spokenText');
        if (spokenEl) spokenEl.value = content;
        
        const ttsVoice = document.getElementById('ttsVoice').value;
        const spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(content)}</voice></speak>`;
        
        document.getElementById('audio').muted = false;
        await avatarSynthesizer.speakSsmlAsync(spokenSsml);
        
    } catch (err) {
        log('Erro ao falar lição: ' + err.message);
    }
};

// Move to next lesson
window.nextLesson = async () => {
    try {
        const resp = await fetch('/api/teaching/next', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to move to next');
        
        const data = await resp.json();
        if (data.success) {
            if (data.finished) {
                log('🎉 Curso finalizado!');
                window.stopTeaching();
            } else {
                await window.loadCurrentLesson();
            }
        }
    } catch (err) {
        log('Erro ao avançar lição: ' + err.message);
    }
};

// Ask question during teaching
window.askTeachingQuestion = async () => {
    try {
        const input = document.getElementById('teachingPrompt');
        const message = (input.value || '').trim();
        if (!message) return;
        
        const immediate = document.getElementById('immediateAnswer').checked;
        
        // Add question to teaching chat history
        window.addToTeachingChatHistory(message, true);
        input.value = '';
        
        document.getElementById('askTeachingQuestion').disabled = true;
        
        const resp = await fetch('/api/teaching/question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, immediate })
        });
        
        if (!resp.ok) throw new Error('Failed to process question');
        
        const data = await resp.json();
        if (data.success) {
            if (data.type === 'immediate') {
                // Add answer to chat and speak it
                window.addToTeachingChatHistory(data.answer, false);
                await window.speakLesson(data.answer);
            } else {
                // Queued response
                window.addToTeachingChatHistory('✅ ' + data.message, false);
            }
        }
        
    } catch (err) {
        log('Erro ao processar pergunta: ' + err.message);
        window.addToTeachingChatHistory('❌ Erro ao processar pergunta', false);
    } finally {
        document.getElementById('askTeachingQuestion').disabled = false;
    }
};

// Add message to teaching chat history
window.addToTeachingChatHistory = (message, isUser = false) => {
    const timestamp = new Date().toLocaleTimeString();
    const chatHistoryElement = document.getElementById('teachingChatHistory');
    
    if (chatHistoryElement) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
        messageDiv.innerHTML = `
            <div class="message-content">${message}</div>
            <div class="message-time">${timestamp}</div>
        `;
        chatHistoryElement.appendChild(messageDiv);
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }
};

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [ useTcpForWebRTC ? iceServerUrl.replace(':3478', ':443?transport=tcp') : iceServerUrl ],
            username: iceServerUsername,
            credential: iceServerCredential
        }],
        iceTransportPolicy: useTcpForWebRTC ? 'relay' : 'all'
    })

    // Fetch WebRTC video stream and mount it to an HTML video element
    peerConnection.ontrack = function (event) {
        // Clean up existing video element if there is any
        remoteVideoDiv = document.getElementById('remoteVideo')
        for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
            if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
            }
        }

        const mediaPlayer = document.createElement(event.track.kind)
        mediaPlayer.id = event.track.kind
        mediaPlayer.srcObject = event.streams[0]
        mediaPlayer.autoplay = false
        mediaPlayer.addEventListener('loadeddata', () => {
            mediaPlayer.play()
        })

        document.getElementById('remoteVideo').appendChild(mediaPlayer)
        document.getElementById('videoLabel').hidden = true
        document.getElementById('overlayArea').hidden = false

        if (event.track.kind === 'video') {
            mediaPlayer.playsInline = true
            remoteVideoDiv = document.getElementById('remoteVideo')
            canvas = document.getElementById('canvas')
            if (document.getElementById('transparentBackground').checked) {
                remoteVideoDiv.style.width = '0.1px'
                canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
                canvas.hidden = false
            } else {
                canvas.hidden = true
            }

            mediaPlayer.addEventListener('play', () => {
                if (document.getElementById('transparentBackground').checked) {
                    window.requestAnimationFrame(makeBackgroundTransparent)
                } else {
                    remoteVideoDiv.style.width = mediaPlayer.videoWidth / 2 + 'px'
                }
            })
        }
        else
        {
            // Mute the audio player to make sure it can auto play, will unmute it when speaking
            // Refer to https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide
            mediaPlayer.muted = true
        }
    }

    // Listen to data channel, to get the event from the server
    peerConnection.addEventListener("datachannel", event => {
        const dataChannel = event.channel
        dataChannel.onmessage = e => {
            let spokenText = document.getElementById('spokenText').value
            let subtitles = document.getElementById('subtitles')
            const webRTCEvent = JSON.parse(e.data)
            if (webRTCEvent.event.eventType === 'EVENT_TYPE_TURN_START' && document.getElementById('showSubtitles').checked) {
                subtitles.hidden = false
                subtitles.innerHTML = spokenText
            } else if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END' || webRTCEvent.event.eventType === 'EVENT_TYPE_SWITCH_TO_IDLE') {
                subtitles.hidden = true
            }
            console.log("[" + (new Date()).toISOString() + "] WebRTC event received: " + e.data)
        }
    })

    // This is a workaround to make sure the data channel listening is working by creating a data channel from the client side
    c = peerConnection.createDataChannel("eventChannel")

    // Make necessary update to the web page when the connection state changes
    peerConnection.oniceconnectionstatechange = e => {
        log("WebRTC status: " + peerConnection.iceConnectionState)

        if (peerConnection.iceConnectionState === 'connected') {
            document.getElementById('stopSession').disabled = false
            document.getElementById('speak').disabled = false
            const askAIButton = document.getElementById('askAI')
            if (askAIButton) askAIButton.disabled = false
            document.getElementById('configuration').hidden = true
        }

        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            document.getElementById('speak').disabled = true
            document.getElementById('stopSpeaking').disabled = true
            document.getElementById('stopSession').disabled = true
            document.getElementById('startSession').disabled = false
            const askAIButton = document.getElementById('askAI')
            if (askAIButton) askAIButton.disabled = true
            document.getElementById('configuration').hidden = false
        }
    }

    // Offer to receive 1 audio, and 1 video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' })
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' })

    // start avatar, establish WebRTC connection
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId)
        } else {
            console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId)
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r)
                if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                    console.log(cancellationDetails.errorDetails)
                };
                log("Unable to start avatar: " + cancellationDetails.errorDetails);
            }
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    }).catch(
        (error) => {
            console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error)
            document.getElementById('startSession').disabled = false
            document.getElementById('configuration').hidden = false
        }
    );
}

// Ask AI and speak response
window.askAI = async () => {
    try {
        const btn = document.getElementById('askAI')
        const input = document.getElementById('userPrompt')
        if (!btn || !input) return
        const message = (input.value || '').trim()
        if (!message) return
        
        // Add user message to chat history
        window.addToChatHistory(message, true);
        
        btn.disabled = true
        document.getElementById('stopSpeaking').disabled = false
        input.value = ''; // Clear input

        // Prefer LangGraph endpoint; fallback to generate
        let resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        })
        if (!resp.ok) {
            // fallback legacy endpoint
            resp = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            })
            if (!resp.ok) {
                const t = await resp.text()
                throw new Error(t || 'AI request failed')
            }
        }
        const data = await resp.json()
        const aiText = data.text || ''
        if (!aiText) throw new Error('Empty AI response')

        // Add AI response to chat history
        window.addToChatHistory(aiText, false);

        // Mirror into spokenText for subtitles behavior
        const spokenEl = document.getElementById('spokenText')
        if (spokenEl) spokenEl.value = aiText

        const ttsVoice = document.getElementById('ttsVoice').value
        const spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(aiText)}</voice></speak>`
        document.getElementById('audio').muted = false
        await avatarSynthesizer.speakSsmlAsync(spokenSsml)
    } catch (err) {
        log('AI error: ' + (err?.message || String(err)))
        window.addToChatHistory('❌ Erro: ' + (err?.message || 'Falha na comunicação'), false);
    } finally {
        const btn = document.getElementById('askAI')
        if (btn) btn.disabled = false
        document.getElementById('stopSpeaking').disabled = true
    }
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
    // Throttle the frame rate to 30 FPS to reduce CPU usage
    if (timestamp - previousAnimationFrameTimestamp > 30) {
        video = document.getElementById('video')
        tmpCanvas = document.getElementById('tmpCanvas')
        tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
        tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        if (video.videoWidth > 0) {
            let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
            for (let i = 0; i < frame.data.length / 4; i++) {
                let r = frame.data[i * 4 + 0]
                let g = frame.data[i * 4 + 1]
                let b = frame.data[i * 4 + 2]
                if (g - 150 > r + b) {
                    // Set alpha to 0 for pixels that are close to green
                    frame.data[i * 4 + 3] = 0
                } else if (g + g > r + b) {
                    // Reduce green part of the green pixels to avoid green edge issue
                    adjustment = (g - (r + b) / 2) / 3
                    r += adjustment
                    g -= adjustment * 2
                    b += adjustment
                    frame.data[i * 4 + 0] = r
                    frame.data[i * 4 + 1] = g
                    frame.data[i * 4 + 2] = b
                    // Reduce alpha part for green pixels to make the edge smoother
                    a = Math.max(0, 255 - adjustment * 4)
                    frame.data[i * 4 + 3] = a
                }
            }

            canvas = document.getElementById('canvas')
            canvasContext = canvas.getContext('2d')
            canvasContext.putImageData(frame, 0, 0);
        }

        previousAnimationFrameTimestamp = timestamp
    }

    window.requestAnimationFrame(makeBackgroundTransparent)
}
// Do HTML encoding on given text
function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };

    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match])
}

window.startSession = () => {
    const cogSvcRegion = document.getElementById('region').value
    const cogSvcSubKey = document.getElementById('APIKey').value
    if (cogSvcSubKey === '') {
        alert('Please fill in the API key of your speech resource.')
        return
    }

    const privateEndpointEnabled = document.getElementById('enablePrivateEndpoint').checked
    const privateEndpoint = document.getElementById('privateEndpoint').value.slice(8)
    if (privateEndpointEnabled && privateEndpoint === '') {
        alert('Please fill in the Azure Speech endpoint.')
        return
    }

    let speechSynthesisConfig
    if (privateEndpointEnabled) {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`), cogSvcSubKey) 
    } else {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion)
    }
    speechSynthesisConfig.endpointId = document.getElementById('customVoiceEndpointId').value

    const videoFormat = new SpeechSDK.AvatarVideoFormat()
    let videoCropTopLeftX = document.getElementById('videoCrop').checked ? 600 : 0
    let videoCropBottomRightX = document.getElementById('videoCrop').checked ? 1320 : 1920
    videoFormat.setCropRange(new SpeechSDK.Coordinate(videoCropTopLeftX, 0), new SpeechSDK.Coordinate(videoCropBottomRightX, 1080));

    const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value
    const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value
    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle, videoFormat)
    avatarConfig.customized = document.getElementById('customizedAvatar').checked
    avatarConfig.useBuiltInVoice = document.getElementById('useBuiltInVoice').checked 
    avatarConfig.backgroundColor = document.getElementById('backgroundColor').value
    avatarConfig.backgroundImage = document.getElementById('backgroundImageUrl').value

    document.getElementById('startSession').disabled = true
    
    const xhr = new XMLHttpRequest()
    if (privateEndpointEnabled) {
        xhr.open("GET", `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`)
    } else {
        xhr.open("GET", `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`)
    }
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey)
    xhr.addEventListener("readystatechange", function() {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText)
            const iceServerUrl = responseData.Urls[0]
            const iceServerUsername = responseData.Username
            const iceServerCredential = responseData.Password

            avatarConfig.remoteIceServers = [{
                urls: [ iceServerUrl ],
                username: iceServerUsername,
                credential: iceServerCredential
            }]

            avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig)
            avatarSynthesizer.avatarEventReceived = function (s, e) {
                var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms."
                if (e.offset === 0) {
                    offsetMessage = ""
                }
                console.log("[" + (new Date()).toISOString() + "] Event received: " + e.description + offsetMessage)
            }

            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential)
        }
    })
    xhr.send()
    
}

window.speak = () => {
    document.getElementById('speak').disabled = true;
    document.getElementById('stopSpeaking').disabled = false
    document.getElementById('audio').muted = false
    let spokenText = document.getElementById('spokenText').value
    let ttsVoice = document.getElementById('ttsVoice').value
    let spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(spokenText)}</voice></speak>`
    console.log("[" + (new Date()).toISOString() + "] Speak request sent.")
    avatarSynthesizer.speakSsmlAsync(spokenSsml).then(
        (result) => {
            document.getElementById('speak').disabled = false
            document.getElementById('stopSpeaking').disabled = true
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log("[" + (new Date()).toISOString() + "] Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId)
            } else {
                console.log("[" + (new Date()).toISOString() + "] Unable to speak text. Result ID: " + result.resultId)
                if (result.reason === SpeechSDK.ResultReason.Canceled) {
                    let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
                    console.log(cancellationDetails.reason)
                    if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                        console.log(cancellationDetails.errorDetails)
                    }
                }
            }
        }).catch(log);
}


window.stopSpeaking = () => {
    document.getElementById('stopSpeaking').disabled = true

    avatarSynthesizer.stopSpeakingAsync().then(
        log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
    ).catch(log);
}

window.stopSession = () => {
    document.getElementById('speak').disabled = true
    document.getElementById('stopSession').disabled = true
    document.getElementById('stopSpeaking').disabled = true
    avatarSynthesizer.close()
}

window.updataTransparentBackground = () => {
    if (document.getElementById('transparentBackground').checked) {
        document.body.background = './image/background.png'
        document.getElementById('backgroundColor').value = '#00FF00FF'
        document.getElementById('backgroundColor').disabled = true
    } else {
        document.body.background = ''
        document.getElementById('backgroundColor').value = '#FFFFFFFF'
        document.getElementById('backgroundColor').disabled = false
    }
}

window.updatePrivateEndpoint = () => {
    if (document.getElementById('enablePrivateEndpoint').checked) {
        document.getElementById('showPrivateEndpointCheckBox').hidden = false
    } else {
        document.getElementById('showPrivateEndpointCheckBox').hidden = true
    }
}

window.updateCustomAvatarBox = () => {
    if (document.getElementById('customizedAvatar').checked) {
        document.getElementById('useBuiltInVoice').disabled = false
    } else {
        document.getElementById('useBuiltInVoice').disabled = true
        document.getElementById('useBuiltInVoice').checked = false
    }
}
