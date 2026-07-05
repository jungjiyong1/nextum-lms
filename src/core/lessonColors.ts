// Shared lesson color utilities for timetable components
// Muted/desaturated colors for lesson blocks (olive, sage, beige + complementary tones)

export const LESSON_COLORS = [
    { bg: 'bg-[#c5c9a4]', text: 'text-[#3d3f2f]' },  // Olive green
    { bg: 'bg-[#d4d4c8]', text: 'text-[#4a4a42]' },  // Warm gray
    { bg: 'bg-[#bdc3a7]', text: 'text-[#3a3e2d]' },  // Sage green
    { bg: 'bg-[#d6cfc2]', text: 'text-[#4d4538]' },  // Beige/Sand
    { bg: 'bg-[#c9c5b8]', text: 'text-[#45433b]' },  // Stone
    { bg: 'bg-[#b8c4a8]', text: 'text-[#3b4230]' },  // Muted green
    { bg: 'bg-[#d0c9b8]', text: 'text-[#4a4539]' },  // Khaki
    { bg: 'bg-[#c2c8b5]', text: 'text-[#3e4235]' },  // Moss
    { bg: 'bg-[#ccc9be]', text: 'text-[#46443c]' },  // Taupe
    { bg: 'bg-[#b5c2a4]', text: 'text-[#384230]' },  // Fern
    // Complementary muted tones
    { bg: 'bg-[#d4c4c4]', text: 'text-[#4a3d3d]' },  // Dusty rose
    { bg: 'bg-[#b8c4c9]', text: 'text-[#3a4245]' },  // Slate blue
    { bg: 'bg-[#d4c4b4]', text: 'text-[#4a4035]' },  // Terracotta
    { bg: 'bg-[#c9c4d0]', text: 'text-[#423d48]' },  // Mauve
    { bg: 'bg-[#b4c9c4]', text: 'text-[#354542]' },  // Seafoam
];

/**
 * Get consistent color for a lesson based on its ID or rule ID
 * @param lesson - Lesson object with id and optional ruleId
 * @returns Color object with bg and text Tailwind classes
 */
export const getLessonColor = (lesson: { id: number; ruleId?: number | null }) => {
    // Use ruleId for recurring lessons to keep color stable across edits
    const colorKey = lesson.ruleId ?? lesson.id;
    return LESSON_COLORS[colorKey % LESSON_COLORS.length];
};
