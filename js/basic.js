// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var avatarSynthesizer
var peerConnection
var k = false
var previousAnimationFrameTimestamp = 0;
// Helpers for gesture placeholders used by buildSsml
function chooseGesture(options) {
    try {
        const idx = Math.floor(Math.random() * options.length);
        return options[idx];
    } catch { return null; }
}

function insertGesturePlaceholders(text) {
    if (!text) return '';
    let used = 0;
    const paragraphs = String(text).split(/\n\n+/);
    const processed = paragraphs.map(p => {
        let out = p;
        if (/(?:\b(olá|oi|hello|bem[- ]?vindo|bem[- ]?vindos)\b)/i.test(out) && used < 2) {
            const g = chooseGesture(['wave-left-1','hello','say-hi']);
            if (g) { out = out.replace(/\b(olá|oi|hello|bem[- ]?vindo|bem[- ]?vindos)\b/i, m => `${m} <<gesture.${g}>>`); used++; }
        }
        if (/(?:\b(obrigado|obrigada|thanks|valeu)\b)/i.test(out) && used < 2) {
            const g = chooseGesture(['thanks','applaud','thumbsup-left-1']);
            if (g) { out = out.replace(/\b(obrigado|obrigada|thanks|valeu)\b/i, m => `${m} <<gesture.${g}>>`); used++; }
        }
        if (/(?:\b(atenção|importante)\b)/i.test(out) && used < 2) {
            const g = chooseGesture(['show-front-1','front-right']);
            if (g) { out = out.replace(/\b(atenção|importante)\b/i, m => `${m} <<gesture.${g}>>`); used++; }
        }
        if (/(^|\s)(1\.|1º|primeiro)\b/i.test(out) && used < 2) {
            const g = chooseGesture(['numeric1-left-1','number-one']);
            if (g) { out = out.replace(/(^|\s)(1\.|1º|primeiro)\b/i, (m, sp) => `${sp}${m.trim()} <<gesture.${g}>>`); used++; }
        }
        if (/(?:\b(veja|olhe)\b)/i.test(out) && used < 2) {
            const g = chooseGesture(['point-left-1','show-left-1','show-right-1']);
            if (g) { out = out.replace(/\b(veja|olhe)\b/i, m => `${m} <<gesture.${g}>>`); used++; }
        }
        if (/(?:\b(certo\?|ok\?|vamos lá\?)\b)/i.test(out) && used < 2) {
            const g = chooseGesture(['nod']);
            if (g) { out = out.replace(/\b(certo\?|ok\?|vamos lá\?)\b/i, m => `${m} <<gesture.${g}>>`); used++; }
        }
        return out;
    });
    return processed.join('\n\n');
}

function injectGestureBookmarks(ssml) {
    if (!ssml) return ssml;
    // Replace encoded placeholders with actual SSML bookmark tags
    return ssml.replace(/&lt;&lt;gesture\.([a-z0-9\-]+)&gt;&gt;/g, (_m, name) => `<bookmark mark='gesture.${name}'/>`);
}

function scrubResidualGestureLiterals(ssml) {
    if (!ssml) return ssml;
    // Remove any leftover placeholders that weren't converted (safety net)
    return ssml
        // Unencoded placeholders
        .replace(/<<gesture\.[^>]+>>/gi, '')
        // Encoded placeholders
        .replace(/&lt;&lt;gesture\.[^&]+&gt;&gt;/gi, '');
}

// Chat History Management
window.addToChatHistory = (message, isUser = false, sources = undefined) => {
    const timestamp = new Date().toLocaleTimeString();
    chatHistory.push({ message, isUser, timestamp, sources });
    
    const chatHistoryElement = document.getElementById('chatHistory');
    if (chatHistoryElement) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
        let sourcesHtml = '';
        if (!isUser && Array.isArray(sources) && sources.length) {
            const items = sources.map((s, i) => {
                const doc = s.document || {};
                const title = doc.title || doc.name || doc.id || `Fonte ${i+1}`;
                const url = doc.url;
                const score = typeof s.score === 'number' ? ` (score=${s.score.toFixed(2)})` : '';
                const label = (title + score).replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return url ? `<li><a href="${url}" target="_blank" rel="noopener">${label}</a></li>` : `<li>${label}</li>`;
            }).join('');
            sourcesHtml = `<div class="sources"><div class="sources-title">🔎 Fontes</div><ul>${items}</ul></div>`;
        }
        messageDiv.innerHTML = `
            <div class="message-content">${message}</div>
            ${sourcesHtml}
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
    // Ensure chat is usable even without avatar session (only disabled in course mode)
    const askAIButton = document.getElementById('askAI');
    if (askAIButton) askAIButton.disabled = false;
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
        // Load course catalog when entering teaching mode
        window.loadCourseCatalog();
    } else {
        modeText.textContent = '💬 Chat Mode';
        chatSection.style.display = 'block';
        teachingSection.style.display = 'none';
    // Re-enable chat input when leaving course mode
    const askAIButton = document.getElementById('askAI');
    if (askAIButton) askAIButton.disabled = false;
        // Stop teaching if active
        if (teachingState.isActive) {
            window.stopTeaching();
        }
    }
};

// Split content into paragraphs (same logic as buildSsml)
function getParagraphsFromContent(content) {
    const plain = stripMarkdown(content || '');
    return plain.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
}

// Load course catalog
window.loadCourseCatalog = async () => {
    console.log('🔄 Iniciando carregamento do catálogo de cursos...');
    try {
        const resp = await fetch('/api/courses');
        console.log('📡 Resposta recebida:', resp.status, resp.statusText);
        if (!resp.ok) throw new Error('Failed to load courses');
        
        const data = await resp.json();
        console.log('📊 Dados recebidos:', data);
        const courses = data.courses || [];
        console.log('📚 Cursos extraídos:', courses.length, courses);
        
        const courseGrid = document.getElementById('courseGrid');
        console.log('🎯 Elemento courseGrid encontrado:', !!courseGrid, courseGrid);
        if (!courseGrid) {
            console.error('❌ Elemento courseGrid não encontrado!');
            return;
        }
        
        const htmlContent = courses.map(course => `
            <div class="course-card" onclick="window.selectCourse('${course.id}')">
                <h4>${course.title}</h4>
                <div class="course-level ${course.level}">${course.level}</div>
                <div class="course-duration">⏱️ ${course.duration}</div>
                <div class="course-description">${course.description}</div>
            </div>
        `).join('');
        
        console.log('🏗️ HTML gerado:', htmlContent);
        courseGrid.innerHTML = htmlContent;
        console.log('✅ innerHTML atualizado. courseGrid agora contém:', courseGrid.innerHTML.length, 'caracteres');
        
        log(`📚 Carregados ${courses.length} cursos disponíveis`);
    } catch (err) {
        console.error('❌ Erro detalhado:', err);
        log('❌ Erro ao carregar catálogo de cursos: ' + err.message);
    }
};

// Select a course
window.selectCourse = (courseId) => {
    selectedCourseId = courseId;
    
    // Update visual selection
    document.querySelectorAll('.course-card').forEach(card => {
        card.classList.remove('selected');
    });
    event.target.closest('.course-card').classList.add('selected');
    
    // Show teaching controls
    document.getElementById('courseSelection').style.display = 'none';
    document.getElementById('teachingControls').classList.remove('hidden');
    document.getElementById('startTeaching').disabled = false;
    
    log(`📖 Curso selecionado: ${courseId}`);
};

// Show course selection screen
window.showCourseSelection = () => {
    selectedCourseId = null;
    document.getElementById('courseSelection').style.display = 'block';
    document.getElementById('teachingControls').classList.add('hidden');
    document.getElementById('lessonProgress').classList.add('hidden');
    document.getElementById('lessonContent').classList.add('hidden');
    
    // Reset controls
    document.getElementById('startTeaching').disabled = true;
    const pauseBtn = document.getElementById('pauseTeaching'); if (pauseBtn) pauseBtn.style.display = 'none';
    const stopBtn = document.getElementById('stopPlayback'); if (stopBtn) stopBtn.disabled = true;
    document.getElementById('stopTeaching').disabled = true;
    document.getElementById('backToCourses').disabled = true;
};

// Start teaching session
window.startTeaching = async () => {
    try {
        // Verify avatar is ready
        if (!avatarSynthesizer) {
            log('⚠️ Configure e inicie a sessão do avatar antes de começar o curso!');
            window.addToChatHistory('⚠️ Configure o avatar primeiro nas configurações e clique em "🚀 Start Session"', false);
            return;
        }
        
        if (!selectedCourseId) {
            log('⚠️ Selecione um curso primeiro!');
            return;
        }
        
        const resp = await fetch('/api/teaching/start', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: selectedCourseId })
        });
        if (!resp.ok) throw new Error('Failed to start teaching');
        
        const data = await resp.json();
        teachingState.isActive = true;
        
        // Update UI
    document.getElementById('startTeaching').disabled = true;
    const pauseBtn = document.getElementById('pauseTeaching'); if (pauseBtn) pauseBtn.style.display = 'none';
    const stopBtn = document.getElementById('stopPlayback'); if (stopBtn) stopBtn.disabled = false;
    document.getElementById('stopTeaching').disabled = false;
        document.getElementById('backToCourses').disabled = false;
        document.getElementById('lessonProgress').classList.remove('hidden');
        
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
        // Show pending questions before stopping
        await window.showPendingQuestions();
        
        const resp = await fetch('/api/teaching/stop', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to stop teaching');
        
        teachingState.isActive = false;
    try { teachingBatchCancel.cancel = true; } catch {}
        
        // Stop any batch video playback
        try {
            const batchVideo = document.getElementById('batchVideo');
            if (batchVideo) { batchVideo.pause(); batchVideo.currentTime = 0; }
        } catch {}
        // Update UI
        document.getElementById('startTeaching').disabled = false;
    const pauseBtn2 = document.getElementById('pauseTeaching'); if (pauseBtn2) pauseBtn2.style.display = 'none';
    const stopBtn = document.getElementById('stopPlayback'); if (stopBtn) stopBtn.disabled = true;
        document.getElementById('stopTeaching').disabled = true;
        document.getElementById('backToCourses').disabled = true;
        document.getElementById('lessonProgress').classList.add('hidden');
        document.getElementById('lessonContent').classList.add('hidden');
        
        // Show course selection again
        window.showCourseSelection();
        
        
        log('🛑 Sessão de ensino finalizada!');
    } catch (err) {
        log('Erro ao parar ensino: ' + err.message);
    }
};

// Pause teaching (stop avatar speaking)
// Pause disabled in simplified controls; use stopPlayback instead
window.pauseTeaching = () => {
    const btn = document.getElementById('pauseTeaching'); if (btn) btn.style.display = 'none';
    window.stopPlayback();
};

// Show pending questions at end of session
window.showPendingQuestions = async () => {
    try {
        const resp = await fetch('/api/teaching/answer-pending', { method: 'POST' });
        if (!resp.ok) throw new Error('Failed to get pending answers');
        
        const data = await resp.json();
        if (data.success && data.answers && data.answers.length > 0) {
            log(`📋 Respondendo ${data.answers.length} perguntas importantes:`);
            // Preface before answering queued questions (calmer style)
            await window.speakLesson('Então, respondendo ao chat:', ssmlOptionsFor('preface'), 'preface');
            
            for (const qa of data.answers) {
                await window.speakLesson(qa.answer, ssmlOptionsFor('queuedAnswer'), 'queuedAnswer');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            log('✅ Todas as perguntas pendentes foram respondidas!');
        } else {
            log('ℹ️ Nenhuma pergunta pendente para responder.');
        }
    } catch (err) {
        log('Erro ao responder perguntas pendentes: ' + err.message);
    }
};

// Answer pending questions for the current topic (called before advancing)
window.answerPendingForCurrentTopic = async () => {
    try {
        const resp = await fetch('/api/teaching/answer-pending?scope=currentTopic', { method: 'POST' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.success && data.answers && data.answers.length > 0) {
            await window.speakLesson('Antes de avançarmos, respondendo as perguntas deste tópico:', ssmlOptionsFor('preface'), 'preface');
            for (const qa of data.answers) {
                await window.speakLesson(qa.answer, ssmlOptionsFor('queuedAnswer'), 'queuedAnswer');
                await new Promise(r => setTimeout(r, 600));
            }
        }
    } catch {}
};

// Load current lesson content
window.loadCurrentLesson = async () => {
    try {
        log('📚 Carregando próxima lição...');
        
        const resp = await fetch('/api/teaching/lesson', { method: 'POST' });
        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${errorText}`);
        }
        
        const data = await resp.json();
        if (data.success) {
            const lesson = data.lesson;
            
            // Update progress
            teachingState.currentTopic = lesson.topicTitle;
            teachingState.currentSubtask = lesson.subtaskTitle;
            teachingState.progress = lesson.progress;
            
            log(`🎯 Tópico: ${lesson.topicTitle} - ${lesson.subtaskTitle}`);
            
            // Update UI
            document.getElementById('currentTopic').textContent = 
                `${lesson.topicTitle} - ${lesson.subtaskTitle}`;
            document.getElementById('progressText').textContent = 
                `${lesson.progress.topicIndex + 1}/${lesson.progress.totalTopics} - ${lesson.progress.subtaskIndex + 1}/${lesson.progress.totalSubtasks}`;
            
            const progressPercent = ((lesson.progress.topicIndex * 10 + lesson.progress.subtaskIndex + 1) / (lesson.progress.totalTopics * 10)) * 100;
            document.getElementById('progressFill').style.width = `${progressPercent}%`;
            
            // Hide lesson text to avoid showing avatar script on screen
            const lessonContent = document.getElementById('lessonContent');
            if (lessonContent) {
                lessonContent.innerHTML = '';
                lessonContent.classList.add('hidden');
            }
            
            // Prefer chunked batch video with gestures; fallback to real-time paragraph playback
            try {
                teachingBatchCancel = { cancel: false };
                await window.playLessonAsBatchSegments(lesson.content);
            } catch (e) {
                log('ℹ️ Batch indisponível no curso, usando reprodução em tempo real. ' + (e?.message || e));
                startLessonPlayback(lesson.content);
            }
            
        } else {
            throw new Error(data.error || 'Failed to load lesson');
        }
    } catch (err) {
        log('❌ Erro ao carregar lição: ' + err.message);
        console.error('Lesson loading error:', err);
    }
};

// Play full lesson as a single batch video with gestures
window.playLessonAsBatch = async (lessonText) => {
    if (!lessonText) throw new Error('Conteúdo vazio');
    const ttsVoice = document.getElementById('ttsVoice')?.value || '';
    const ssml = buildSsml(lessonText, ttsVoice, ssmlOptionsFor('lesson'));
    lastSpokenSsml = ssml;
    const region = document.getElementById('region')?.value || '';
    const character = document.getElementById('talkingAvatarCharacter')?.value || 'lisa';
    const style = document.getElementById('talkingAvatarStyle')?.value || 'casual-sitting';
    const backgroundColor = document.getElementById('backgroundColor')?.value || '#FFFFFFFF';
    const payload = { region, ssml, character, style, backgroundColor, videoFormat: 'mp4', videoCodec: 'h264', subtitleType: 'soft_embedded' };

    const stopBtn1 = document.getElementById('stopPlayback');
    if (stopBtn1) stopBtn1.disabled = false;
    log('🎬 Gerando vídeo do curso com gestos...');

    const submit = await fetch('/api/avatar/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!submit.ok) {
        const t = await submit.text();
        throw new Error('Falha ao enviar batch do curso: ' + t);
    }
    const sd = await submit.json();
    const opLoc = sd.operationLocation;
    if (!opLoc) throw new Error('Operation-Location ausente');

    const start = Date.now();
    const timeoutMs = 90000; // 90s
    let resultUrl = null, status = 'NotStarted';
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, 3000));
        const st = await fetch(`/api/avatar/batch-status?operationLocation=${encodeURIComponent(opLoc)}`);
        if (!st.ok) {
            const tt = await st.text();
            throw new Error('Falha ao consultar status: ' + tt);
        }
        const sj = await st.json();
        status = sj.status;
        resultUrl = sj.resultUrl;
        if (status === 'Succeeded' && resultUrl) break;
        if (status === 'Failed') throw new Error('Batch do curso falhou');
    }
    if (!resultUrl) throw new Error('Sem resultado do batch no tempo esperado');

    const batchVideo = document.getElementById('batchVideo');
    if (!batchVideo) throw new Error('Elemento de vídeo batch não encontrado');
    batchVideo.src = resultUrl;
    batchVideo.hidden = false;
    await batchVideo.play().catch(() => {});
    batchVideo.onended = () => { window.nextLesson(); };
}

// Play lesson as multiple short batch segments for lower latency
window.playLessonAsBatchSegments = async (lessonText) => {
    const region = document.getElementById('region')?.value || '';
    const character = document.getElementById('talkingAvatarCharacter')?.value || 'lisa';
    const style = document.getElementById('talkingAvatarStyle')?.value || 'casual-sitting';
    const backgroundColor = document.getElementById('backgroundColor')?.value || '#FFFFFFFF';
    const ttsVoice = document.getElementById('ttsVoice')?.value || '';
    const batchVideo = document.getElementById('batchVideo');
    if (!batchVideo) throw new Error('Elemento de vídeo batch não encontrado');
    if (!lessonText) throw new Error('Conteúdo vazio');

    const paras = getParagraphsFromContent(lessonText);
    const segments = [];
    // Split into ~2-3 sentence chunks per paragraph
    const splitIntoSentences = (text) => {
        const tokens = text.split(/([.!?…])/);
        const out = [];
        for (let i = 0; i < tokens.length; i += 2) {
            const part = (tokens[i] || '').trim();
            const punct = tokens[i + 1] || '';
            const sentence = (part + punct).trim();
            if (sentence) out.push(sentence);
        }
        return out;
    };
    for (const p of paras) {
        const sents = splitIntoSentences(p);
        let buf = [];
        for (const s of sents) {
            buf.push(s);
            const chars = buf.join(' ').length;
            if (buf.length >= 3 || chars > 260) { // small chunk
                segments.push(buf.join(' '));
                buf = [];
            }
        }
        if (buf.length) segments.push(buf.join(' '));
    }

    const stopBtn2 = document.getElementById('stopPlayback');
    if (stopBtn2) stopBtn2.disabled = false;
    log(`🎬 Gerando ${segments.length} segmentos do curso com gestos...`);

    for (let i = 0; i < segments.length; i++) {
        if (teachingBatchCancel.cancel) throw new Error('Cancelado');
        const ssml = buildSsml(segments[i], ttsVoice, ssmlOptionsFor('lesson'));
        lastSpokenSsml = ssml;
        const submit = await fetch('/api/avatar/batch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region, ssml, character, style, backgroundColor, videoFormat: 'mp4', videoCodec: 'h264', subtitleType: 'soft_embedded' })
        });
        if (!submit.ok) {
            const t = await submit.text();
            throw new Error('Falha ao enviar segmento: ' + t);
        }
        const sd = await submit.json();
        const opLoc = sd.operationLocation;
        if (!opLoc) throw new Error('Operation-Location ausente');

        // Shorter timeout per segment
        const start = Date.now();
        const timeoutMs = 45000; // 45s
        let resultUrl = null, status = 'NotStarted';
        while (!teachingBatchCancel.cancel && Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 2000));
            const st = await fetch(`/api/avatar/batch-status?operationLocation=${encodeURIComponent(opLoc)}`);
            if (!st.ok) throw new Error('Falha ao consultar status');
            const sj = await st.json();
            status = sj.status;
            resultUrl = sj.resultUrl;
            if (status === 'Succeeded' && resultUrl) break;
            if (status === 'Failed') throw new Error('Batch do segmento falhou');
        }
        if (teachingBatchCancel.cancel) throw new Error('Cancelado');
        if (!resultUrl) throw new Error('Sem resultado no tempo esperado para segmento');

        // Play this segment
        batchVideo.src = resultUrl;
        batchVideo.hidden = false;
        await batchVideo.play().catch(() => {});
        await new Promise(resolve => {
            const onEnded = () => { batchVideo.removeEventListener('ended', onEnded); resolve(); };
            batchVideo.addEventListener('ended', onEnded);
        });
    }

    // auto-advance when all segments are done
    window.nextLesson();
}

// Make avatar speak lesson content
// Basic Markdown to plain text sanitizer to avoid reading symbols literally
function stripMarkdown(md) {
    if (!md) return '';
    let s = md;
    // Remove code blocks
    s = s.replace(/```[\s\S]*?```/g, '');
    // Inline code
    s = s.replace(/`([^`]+)`/g, '$1');
    // Headings
    s = s.replace(/^#{1,6}\s+/gm, '');
    // Bold/italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1');
    // Images ![alt](url) -> alt
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Links [text](url) -> text
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Lists bullets
    s = s.replace(/^\s*[-+*]\s+/gm, '• ');
    // Blockquotes
    s = s.replace(/^>\s?/gm, '');
    // Excess asterisks/hashtags
    s = s.replace(/[#*_]{1,}/g, '');
    // Collapse spaces
    s = s.replace(/[ \t]+/g, ' ');
    // Normalize newlines
    s = s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

// SSML style presets per content context
function ssmlOptionsFor(kind) {
    switch ((kind || '').toLowerCase()) {
        case 'lesson':
            return { style: 'general', styledegree: '1.0', rate: '-5%', pitch: '+0st' };
        case 'answer':
            return { style: 'general', styledegree: '1.0', rate: '-2%', pitch: '+0st' };
        case 'queuedanswer':
            return { style: 'general', styledegree: '1.0', rate: '-2%', pitch: '+0st' };
        case 'preface':
            return { style: 'general', styledegree: '1.0', rate: '-5%', pitch: '+0st' };
        case 'chat':
        default:
            return { style: 'general', styledegree: '1.0', rate: '+0%', pitch: '+0st' };
    }
}

// Start lesson playback from the beginning
function startLessonPlayback(lessonText) {
    teachingState.currentLessonContent = lessonText || '';
    teachingState.lessonParagraphs = getParagraphsFromContent(lessonText || '');
    teachingState.lessonIndex = 0;
    teachingState.lessonActive = true;
    resumeLessonAfterAnswer = false;
    playLessonFromIndex(teachingState.lessonIndex);
}

// Play a specific lesson paragraph by index
function playLessonFromIndex(index) {
    if (!teachingState.lessonActive) return;
    const paras = teachingState.lessonParagraphs || [];
    if (!paras.length) { teachingState.lessonActive = false; return; }
    if (index < 0 || index >= paras.length) { teachingState.lessonActive = false; return; }
    teachingState.lessonIndex = index;
    const paragraph = paras[index];
    window.speakLesson(paragraph, ssmlOptionsFor('lesson'), 'lesson');
}

function buildSsml(content, ttsVoice, opts = {}) {
    // 1) Sanitize and analyze text for gesture cues
    const withGestures = insertGesturePlaceholders(content || '');
    const plain = stripMarkdown(withGestures || '');
    const paragraphs = plain.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    // Derive xml:lang from voice name when possible (e.g., pt-BR-AntonioNeural)
    let lang = 'pt-BR';
    if (ttsVoice && ttsVoice.includes('-')) {
        const parts = ttsVoice.split('-');
        if (parts.length >= 2) lang = `${parts[0]}-${parts[1]}`;
    }

    const style = opts.style || 'general';
    const styledegree = opts.styledegree || '1.0';
    const rate = opts.rate || '+0%';
    const pitch = opts.pitch || '+0st';
    const sentenceBoundaryMs = opts.sentenceBoundaryMs || '80ms';
    const paragraphBreakMs = opts.paragraphBreakMs || '900ms';

    // Build p/s structure and add small pauses between paragraphs
    const splitIntoSentences = (text) => {
        const tokens = text.split(/([.!?…])/);
        const out = [];
        for (let i = 0; i < tokens.length; i += 2) {
            const part = (tokens[i] || '').trim();
            const punct = tokens[i + 1] || '';
            const sentence = (part + punct).trim();
            if (sentence) out.push(sentence);
        }
        return out;
    };

    const paragraphSsml = paragraphs.map(p => {
        const sentences = splitIntoSentences(p);
        const sentencesSsml = sentences.map(s => `<s>${htmlEncode(s)}</s>`).join('');
        return `<p>${sentencesSsml}</p>`;
    }).join(`
            <break time='${paragraphBreakMs}' />
        `);

    let raw = (
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' ` +
        `xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${lang}'>` +
        `<voice name='${ttsVoice}'>` +
        `<mstts:leadingsilence-exact value='0'/>` +
        `<mstts:silence type='Sentenceboundary' value='${sentenceBoundaryMs}'/>` +
        `<mstts:express-as style='${style}' styledegree='${styledegree}'>` +
        `<prosody rate='${rate}' pitch='${pitch}'>${paragraphSsml}</prosody>` +
        `</mstts:express-as>` +
        `</voice></speak>`
    );
    // 2) Convert placeholders to SSML bookmarks (batch-friendly; ignored em tempo real)
    raw = injectGestureBookmarks(raw);
    // 3) Segurança: caso reste algum literal, remova para não ser falado
    return scrubResidualGestureLiterals(raw);
}

window.speakLesson = async (content, ssmlOptions = undefined, kind = 'generic') => {
    try {
        if (!avatarSynthesizer) {
            log('⚠️ Avatar não está disponível. Configure e inicie a sessão primeiro.');
            return;
        }
        
        // Always interrupt any ongoing speech before starting a new one (for real-time)
        try { await avatarSynthesizer.stopSpeakingAsync(); } catch {}
        
    const ttsVoice = document.getElementById('ttsVoice').value;
    const spokenSsml = buildSsml(content, ttsVoice, ssmlOptions || {});
    lastSpokenSsml = spokenSsml;
    currentSpeechKind = kind || 'generic';
        const hybridOn = document.getElementById('hybridGesturesMode')?.checked;
        if (hybridOn) {
            // Hybrid mode: submit to batch and play clip as near-live
            const stopBtn = document.getElementById('stopPlayback'); if (stopBtn) stopBtn.disabled = false;
            document.getElementById('audio').muted = false;
            try {
                const region = document.getElementById('region')?.value || '';
                const character = document.getElementById('talkingAvatarCharacter')?.value || 'lisa';
                const style = document.getElementById('talkingAvatarStyle')?.value || 'casual-sitting';
                const backgroundColor = document.getElementById('backgroundColor')?.value || '#FFFFFFFF';
                const payload = { region, ssml: spokenSsml, character, style, backgroundColor, videoFormat: 'mp4', videoCodec: 'h264', subtitleType: 'soft_embedded' };
                hybridCancel = { cancel: false };
                const submit = await fetch('/api/avatar/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!submit.ok) throw new Error('Falha no envio batch (hybrid)');
                const sd = await submit.json();
                const opLoc = sd.operationLocation;
                if (!opLoc) throw new Error('Operation-Location ausente (hybrid)');
                // Poll quickly for smaller latência (com fallback rápido)
                const start = Date.now();
                const timeoutMs = 30000; // 30s para fallback rápido
                let resultUrl = null, status = 'NotStarted';
                while (!hybridCancel.cancel && Date.now() - start < timeoutMs) {
                    await new Promise(r => setTimeout(r, 2000));
                    const st = await fetch(`/api/avatar/batch-status?operationLocation=${encodeURIComponent(opLoc)}`);
                    if (!st.ok) throw new Error('Falha ao consultar status (hybrid)');
                    const sj = await st.json();
                    status = sj.status;
                    resultUrl = sj.resultUrl;
                    if (status === 'Succeeded' && resultUrl) break;
                    if (status === 'Failed') throw new Error('Batch falhou (hybrid)');
                }
                if (hybridCancel.cancel) return;
                if (!resultUrl) throw new Error('Sem resultado no tempo esperado (hybrid)');
                // Play
                const batchVideo = document.getElementById('batchVideo');
                if (batchVideo) {
                    batchVideo.src = resultUrl;
                    batchVideo.hidden = false;
                    try { await batchVideo.play(); } catch {}
                }
                const stopBtn2 = document.getElementById('stopPlayback'); if (stopBtn2) stopBtn2.disabled = true;
            } catch (hybridErr) {
                log('ℹ️ Hybrid indisponível, falando em tempo real: ' + (hybridErr?.message || hybridErr));
                // Fallback imediato para tempo real TTS
                document.getElementById('audio').muted = false;
                const stopBtn3 = document.getElementById('stopPlayback'); if (stopBtn3) stopBtn3.disabled = false;
                await avatarSynthesizer.speakSsmlAsync(spokenSsml);
                const stopBtn4 = document.getElementById('stopPlayback'); if (stopBtn4) stopBtn4.disabled = true;
            }
        } else {
            // Real-time default
            document.getElementById('audio').muted = false;
            const stopBtn5 = document.getElementById('stopPlayback'); if (stopBtn5) stopBtn5.disabled = false;
            await avatarSynthesizer.speakSsmlAsync(spokenSsml);
            const stopBtn6 = document.getElementById('stopPlayback'); if (stopBtn6) stopBtn6.disabled = true;
        }
        
    } catch (err) {
        log('Erro ao falar lição: ' + err.message);
    }
};

// Move to next lesson
window.nextLesson = async () => {
    try {
        if (isAdvancing) return;
        isAdvancing = true;
    const stopBtn = document.getElementById('stopPlayback');
    if (stopBtn) stopBtn.disabled = true;

        // Ensure we stop any current speech BEFORE moving to the next lesson
        try { teachingBatchCancel.cancel = true; } catch {}
        try {
            const batchVideo = document.getElementById('batchVideo');
            if (batchVideo) { batchVideo.pause(); batchVideo.currentTime = 0; }
        } catch {}
        try { if (avatarSynthesizer) await avatarSynthesizer.stopSpeakingAsync(); } catch {}

        // Wait briefly for speaking state to settle (max 3s)
        const waitUntil = Date.now() + 3000;
        while (isSpeaking && Date.now() < waitUntil) {
            await new Promise(r => setTimeout(r, 100));
        }

        // Before advancing topic/subtask, answer any pending for current topic
        await window.answerPendingForCurrentTopic();

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
    finally {
        isAdvancing = false;
        const stopBtn3 = document.getElementById('stopPlayback');
        if (stopBtn3) stopBtn3.disabled = false;
    }

// Unified stop for avatar playback and generation (chat or teaching)
window.stopPlayback = async () => {
    try {
        // cancel any ongoing batch generation/playback
        try { teachingBatchCancel.cancel = true; } catch {}
        try { hybridCancel.cancel = true; } catch {}
        try {
            const batchVideo = document.getElementById('batchVideo');
            if (batchVideo) { batchVideo.pause(); batchVideo.currentTime = 0; }
        } catch {}
        try { if (avatarSynthesizer) await avatarSynthesizer.stopSpeakingAsync(); } catch {}
        isSpeaking = false;
        log('⏹️ Reprodução parada.');
        const stopBtn = document.getElementById('stopPlayback'); if (stopBtn) stopBtn.disabled = true;
    } catch (err) {
        log('Erro ao parar reprodução: ' + err.message);
    }
};
};

// Teaching chat is disabled; no question input or history.

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
            if (webRTCEvent.event.eventType === 'EVENT_TYPE_TURN_START') {
                isSpeaking = true
                const show = document.getElementById('showSubtitles').checked
                if (show) {
                    subtitles.hidden = false
                    subtitles.innerHTML = spokenText
                }
                const nextBtn = document.getElementById('nextLesson');
                if (nextBtn) nextBtn.disabled = true;
            } else if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END' || webRTCEvent.event.eventType === 'EVENT_TYPE_SWITCH_TO_IDLE') {
                isSpeaking = false
                subtitles.hidden = true
                const nextBtn = document.getElementById('nextLesson');
                if (nextBtn && !isAdvancing) nextBtn.disabled = false;

                // Resume/continue lesson playback when appropriate
                if (teachingState.isActive && teachingState.lessonActive) {
                    if (currentSpeechKind === 'answer' && resumeLessonAfterAnswer) {
                        // Resume the interrupted paragraph
                        resumeLessonAfterAnswer = false;
                        playLessonFromIndex(teachingState.lessonIndex);
                    } else if (currentSpeechKind === 'lesson') {
                        // Move to next paragraph automatically
                        const nextIndex = teachingState.lessonIndex + 1;
                        if (nextIndex < (teachingState.lessonParagraphs?.length || 0)) {
                            playLessonFromIndex(nextIndex);
                        } else {
                            teachingState.lessonActive = false;
                        }
                    }
                }
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
            document.getElementById('configuration').hidden = true
        }

        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            document.getElementById('stopSession').disabled = true
            document.getElementById('startSession').disabled = false
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
        // Block chat only in Teaching Mode
        if (isTeachingMode) {
            window.addToChatHistory('ℹ️ O chat está desativado no modo Curso. Volte para "Chat Mode" para conversar.', false);
            return;
        }
        const message = (input.value || '').trim()
        if (!message) return
        
        // Add user message to chat history
        window.addToChatHistory(message, true);
        
        btn.disabled = true
        document.getElementById('stopSpeaking').disabled = false
        input.value = ''; // Clear input

        // Use Corrective RAG by default; fallback to RAG tradicional
        // Use a stable thread ID per browsing context (fallback to 'default')
        const threadId = (window.__ragThreadId ||= (Math.random().toString(36).slice(2)));
        let resp = await fetch('/api/chat-crag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, threadId })
        })
        if (!resp.ok) {
            // fallback to standard RAG with memory
            resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, threadId })
            })
            if (!resp.ok) {
                const t = await resp.text()
                throw new Error(t || 'AI request failed')
            }
        }
    const data = await resp.json()
    const aiText = data.text || ''
    const sources = data.sources || []
        if (!aiText) throw new Error('Empty AI response')

        // Add AI response to chat history
    window.addToChatHistory(aiText, false, sources);
        // In Chat Mode, speak AI response via avatar (Course Mode stays muted)
        if (!isTeachingMode && avatarSynthesizer) {
            try {
                await window.speakLesson(aiText, ssmlOptionsFor('chat'), 'chat');
            } catch (e) {
                // fallback to silent if speaking fails
            }
        }
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
    // Reuse the SSML builder so gesture bookmarks and prosody settings apply here too
    const ssml = buildSsml(spokenText, ttsVoice, ssmlOptionsFor('chat'))
    lastSpokenSsml = ssml;
    console.log("[" + (new Date()).toISOString() + "] Speak request sent.")
    avatarSynthesizer.speakSsmlAsync(ssml).then(
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

// Expose helper to copy last SSML (useful for batch synthesis with gestures)
window.copyLastSsmlToClipboard = async () => {
    try {
        if (!lastSpokenSsml) { log('ℹ️ Nenhum SSML gerado ainda.'); return; }
        await navigator.clipboard.writeText(lastSpokenSsml);
        log('📋 SSML copiado para a área de transferência.');
    } catch (e) {
        log('❌ Falha ao copiar SSML: ' + (e?.message || e));
    }
}

// ============ Batch Clip Generation (Gestures) ============
window.generateBatchClip = async () => {
    try {
        if (!lastSpokenSsml) {
            log('ℹ️ Fale algo primeiro ou inicie uma lição para gerar SSML.');
            return;
        }
        const region = document.getElementById('region')?.value || '';
        const character = document.getElementById('talkingAvatarCharacter')?.value || 'lisa';
        const style = document.getElementById('talkingAvatarStyle')?.value || 'casual-sitting';
        const backgroundColor = document.getElementById('backgroundColor')?.value || '#FFFFFFFF';
        const videoFormat = 'mp4';
        const videoCodec = 'h264';
        const subtitleType = 'soft_embedded';
        const body = { region, ssml: lastSpokenSsml, character, style, backgroundColor, videoFormat, videoCodec, subtitleType };

        log('🎬 Enviando job de síntese em lote (gestos)...');
        const submitResp = await fetch('/api/avatar/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!submitResp.ok) {
            const t = await submitResp.text();
            throw new Error('Falha ao enviar job: ' + t);
        }
        const submitData = await submitResp.json();
        const opLoc = submitData.operationLocation;
        if (!opLoc) throw new Error('Operation-Location ausente');

        log('⏳ Processando vídeo com gestos...');
        let status = 'NotStarted';
        let resultUrl = null;
        const deadline = Date.now() + 5 * 60 * 1000; // 5 min timeout
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const s = await fetch(`/api/avatar/batch-status?operationLocation=${encodeURIComponent(opLoc)}`);
            if (!s.ok) {
                const tt = await s.text();
                throw new Error('Falha ao consultar status: ' + tt);
            }
            const sd = await s.json();
            status = sd.status;
            resultUrl = sd.resultUrl;
            if (status === 'Succeeded' && resultUrl) break;
            if (status === 'Failed') throw new Error('Job de batch falhou');
        }
        if (!resultUrl) throw new Error('Tempo esgotado sem resultado');

        log('✅ Vídeo com gestos pronto. Reproduzindo...');
        const liveDiv = document.getElementById('remoteVideo');
        const batchVideo = document.getElementById('batchVideo');
        if (batchVideo) {
            batchVideo.src = resultUrl;
            batchVideo.hidden = false;
            try { batchVideo.play(); } catch {}
        }
        if (liveDiv) {
            // Opcional: ocultar live enquanto toca o batch
            // liveDiv.style.display = 'none';
        }
    } catch (e) {
        log('❌ Erro no batch: ' + (e?.message || e));
    }
}
window.stopSpeaking = () => {
    document.getElementById('stopSpeaking').disabled = true
    // Stop both real-time and hybrid playback
    try { hybridCancel.cancel = true; } catch {}
    try {
        const batchVideo = document.getElementById('batchVideo');
        if (batchVideo && !batchVideo.hidden) {
            batchVideo.pause();
            batchVideo.currentTime = 0;
            // batchVideo.hidden = true; // opcional
        }
    } catch {}
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
