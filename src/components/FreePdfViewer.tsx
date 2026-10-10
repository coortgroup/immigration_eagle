import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { PdfEditorHandle, PdfEditorMessage, PdfEditorProps } from '../pdfEditorBridge';

export const FreePdfViewer = forwardRef<PdfEditorHandle, PdfEditorProps>(function FreePdfViewer({ html, onMessage }, ref) {
  const webview = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({
    reply(message) {
      const payload = JSON.stringify(message).replace(/</g, '\\u003c');
      webview.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message', {data:${payload}}));true;`);
    },
  }), []);
  return <WebView ref={webview} source={{ html }} style={{ flex: 1, backgroundColor: '#E9EEF5' }}
    originWhitelist={['about:*']} javaScriptEnabled domStorageEnabled={false} javaScriptCanOpenWindowsAutomatically={false}
    onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('about:blank#')}
    onMessage={event => {
      try { onMessage(JSON.parse(event.nativeEvent.data) as PdfEditorMessage); }
      catch { /* Ignore unrelated messages from the embedded web runtime. */ }
    }}
    onError={() => onMessage({ type: 'error', error: 'The PDF editor could not be opened. Close this window and try again.' })}
  />;
});
