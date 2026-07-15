const fs = require('fs');
fs.appendFileSync('c:\\Dev\\feelingjournal\\public\\style.css', `
/* Fortune Game Animations */
@keyframes shake-cylinder {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-15deg); }
    75% { transform: rotate(15deg); }
}
.animate-shake-cylinder {
    animation: shake-cylinder 0.3s ease-in-out infinite;
}
@keyframes pop-stick {
    0% { transform: translateY(20px); opacity: 0; }
    50% { transform: translateY(-10px); opacity: 1; }
    100% { transform: translateY(0); opacity: 1; }
}
.animate-pop-stick {
    animation: pop-stick 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
`);
