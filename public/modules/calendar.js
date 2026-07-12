import { loadCalendar } from './calendar/calendarGrid.js?v=11';
import { openDayView, closeDayView } from './calendar/dayView.js?v=11';
import { openTaskEditor, closeTaskEditor } from './calendar/taskEditor.js?v=11';
import { renderV2TaskList } from './calendar/taskList.js?v=11';
import { parseTaskMetadata, serializeTaskMetadata } from './calendar/taskEditor.js?v=11';
import { init } from './calendar/index.js?v=11';

// Re-export core functions for external use
export {
    loadCalendar,
    openDayView,
    closeDayView,
    openTaskEditor,
    closeTaskEditor,
    renderV2TaskList,
    parseTaskMetadata,
    serializeTaskMetadata
};

// Start application logic
init();
