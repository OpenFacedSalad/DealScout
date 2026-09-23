import React from 'react';

export const Logo = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg viewBox="0 0 500 400" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Left Tag - Dark Slate */}
    <g transform="translate(200, 200) rotate(-35) translate(-100, -150)">
      <polygon points="100,20 170,65 170,290 30,290 30,65" fill="#2A3544" />
    </g>

    {/* Right Tag - Emerald Green */}
    <g transform="translate(300, 200) rotate(35) translate(-100, -150)">
      <polygon points="100,20 170,65 170,290 30,290 30,65" fill="#56B98B" />
      {/* Tag Hole */}
      <circle cx="100" cy="75" r="14" fill="#ffffff" />
    </g>

    {/* Binoculars Bridge */}
    <path d="M 190 220 Q 250 190 310 220" stroke="#ffffff" strokeWidth="28" strokeLinecap="round" fill="none" />

    {/* Left Binocular Lens */}
    <circle cx="160" cy="240" r="56" stroke="#ffffff" strokeWidth="16" fill="none" />
    <circle cx="160" cy="240" r="32" fill="#ffffff" />

    {/* Right Binocular Lens */}
    <circle cx="340" cy="240" r="56" stroke="#ffffff" strokeWidth="16" fill="none" />
    <circle cx="340" cy="240" r="32" fill="#ffffff" />
  </svg>
);

export default Logo;
