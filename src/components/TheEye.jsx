/**
 * TheEye - Animated eye component for Panopticon
 *
 * Tracks cursor position (left/centre/right) and blinks periodically.
 * Used in TopBar when Panopticon view is active.
 */

import React, { useState, useEffect, useRef } from 'react';

// Eye assets
import eyecentre from '../assets/panopticon/eyecentre.png';
import eyeleft from '../assets/panopticon/eyeleft.png';
import eyeright from '../assets/panopticon/eyeright.png';
import eyeblink from '../assets/panopticon/eyeblink.png';

function TheEye({ className = '' }) {
  const [eyeState, setEyeState] = useState('centre'); // 'left' | 'centre' | 'right' | 'blink'
  const blinkTimeoutRef = useRef(null);
  const isBlinkingRef = useRef(false);
  const preBlinkStateRef = useRef('centre'); // Remember state before blink

  // Cursor tracking
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isBlinkingRef.current) return;

      const third = window.innerWidth / 3;
      let newState;
      if (e.clientX < third) {
        newState = 'left';
      } else if (e.clientX > third * 2) {
        newState = 'right';
      } else {
        newState = 'centre';
      }
      setEyeState(newState);
      preBlinkStateRef.current = newState; // Track for blink recovery
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Blink animation (every 13-17 seconds)
  // Blink persists for 250ms and is not interruptible
  useEffect(() => {
    let blinkReturnTimeout = null;

    const scheduleBlink = () => {
      const delay = 13000 + Math.random() * 4000; // 13-17 seconds
      blinkTimeoutRef.current = setTimeout(() => {
        isBlinkingRef.current = true;
        setEyeState('blink');

        // Return to previous state after 250ms
        blinkReturnTimeout = setTimeout(() => {
          isBlinkingRef.current = false;
          setEyeState(preBlinkStateRef.current); // Restore pre-blink state
          scheduleBlink();
        }, 250);
      }, delay);
    };

    scheduleBlink();
    return () => {
      if (blinkTimeoutRef.current) clearTimeout(blinkTimeoutRef.current);
      if (blinkReturnTimeout) clearTimeout(blinkReturnTimeout);
    };
  }, []);

  const eyeImages = {
    left: eyeleft,
    centre: eyecentre,
    right: eyeright,
    blink: eyeblink
  };

  return (
    <div className={`the-eye ${className}`}>
      <img src={eyeImages[eyeState]} alt="The Eye" />
    </div>
  );
}

export default TheEye;
