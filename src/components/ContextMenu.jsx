import React, { useEffect, useRef, useCallback } from 'react';
import '../styles/ContextMenu.css';

/**
 * ContextMenu - Right-click context menu component
 *
 * Props:
 * - x, y: Screen coordinates for menu position
 * - items: Array of menu items
 *   - { label: string, action: () => void }
 *   - { label: string, action: () => void, danger: true }
 *   - { label: string, action: () => void, disabled: true }
 *   - { type: 'separator' }
 * - onClose: Callback to close the menu
 */
function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);

  // Adjust position to keep menu on screen
  const getAdjustedPosition = useCallback(() => {
    if (!menuRef.current) return { x, y };

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Flip horizontally if too close to right edge
    if (x + menuRect.width > viewportWidth - 10) {
      adjustedX = x - menuRect.width;
    }

    // Flip vertically if too close to bottom edge
    if (y + menuRect.height > viewportHeight - 10) {
      adjustedY = y - menuRect.height;
    }

    // Ensure we don't go off the left or top edges
    adjustedX = Math.max(10, adjustedX);
    adjustedY = Math.max(10, adjustedY);

    return { x: adjustedX, y: adjustedY };
  }, [x, y]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Add listeners with a small delay to prevent immediate close from the triggering right-click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('scroll', handleScroll, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position after render
  useEffect(() => {
    if (menuRef.current) {
      const { x: adjustedX, y: adjustedY } = getAdjustedPosition();
      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [getAdjustedPosition]);

  const handleItemClick = (item) => {
    if (item.disabled) return;
    item.action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={index} className="context-menu-separator" />;
        }

        const classNames = ['context-menu-item'];
        if (item.danger) classNames.push('danger');
        if (item.disabled) classNames.push('disabled');

        return (
          <div
            key={index}
            className={classNames.join(' ')}
            onClick={() => handleItemClick(item)}
          >
            <span className="context-menu-label">{item.label}</span>
            {item.suffix && (
              <span className="context-menu-suffix">{item.suffix}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ContextMenu;
