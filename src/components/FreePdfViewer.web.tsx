import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PdfEditorHandle, PdfEditorProps } from '../pdfEditorBridge';

export const FreePdfViewer = forwardRef<PdfEditorHandle, PdfEditorProps>(function FreePdfViewer({ html, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => ({ reply(message) { frame.current?.contentWindow?.postMessage(message, '*'); } }), []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'fillout-pdf-editor') return;
      onMessage(event.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onMessage]);
  return <iframe ref={frame} title="Fill, save and print your PDF form" srcDoc={html}
    sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals"
    style={{ display: 'block', border: 0, width: '100%', height: '100%', flex: 1, minHeight: 0, background: '#E9EEF5' }} />;
});
