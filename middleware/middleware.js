const axios = require('axios');
const globals = require('node-global-storage')
class middleware{
    bkash_auth = async(req,res, next)=>{
    globals.unsetValue('id_token')

try {
    const {data} = await axios.post(process.env.BKASH_GRANT_TOKEN_URL,{
        app_key: process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET
    },{
        headers:{
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            username: process.env.BKASH_USERNAME ,
            password: process.env.BKASH_PASSWORD
        }
    })
    globals.setValue('id_token', data.id_token,{protected:true})
    next()
   
} catch (error) {
    return res.status(401).json({error: error.message})
}
    }
}
module.exports = new middleware()