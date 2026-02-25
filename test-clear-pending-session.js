// Test script for CLEAR_PENDING_SESSION message

// Send the CLEAR_PENDING_SESSION message
chrome.runtime.sendMessage({ action: 'CLEAR_PENDING_SESSION' }, (response) => {
    if (response && response.success) {
        console.log('CLEAR_PENDING_SESSION message processed successfully:', response);
    } else {
        console.error('Failed to process CLEAR_PENDING_SESSION message:', response);
    }
});